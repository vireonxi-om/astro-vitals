/* Astro Vitals: read-only Linux sensors. No shell, network, root, or polling
 * subprocesses. One request on stdin produces one JSON line on stdout. */
#define _GNU_SOURCE
#include <ctype.h>
#include <dlfcn.h>
#include <errno.h>
#include <glob.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <time.h>
#include <unistd.h>

typedef struct nvmlDevice_st *Device;
typedef struct { unsigned long long total, free, used; } Memory;
typedef struct {
    unsigned int version;
    unsigned long long total, reserved, free, used;
} Memory2;
static struct {
    void *lib;
    Device device;
    bool initialized, present;
    int (*init)(void), (*shutdown)(void);
    int (*handle)(unsigned int, Device *);
    int (*temperature)(Device, unsigned int, unsigned int *);
    int (*memory)(Device, Memory *);
    int (*memory2)(Device, Memory2 *);
    int (*name)(Device, char *, unsigned int);
    char label[128];
    time_t retry;
} gpu;
static char cpu_paths[32][PATH_MAX];
static size_t cpu_count;
static char cpu_source[96], amd_path[PATH_MAX];
static time_t discovery_time;

static bool read_text(const char *path, char *out, size_t size) {
    FILE *f = fopen(path, "re");
    if (!f) return false;
    bool ok = fgets(out, (int)size, f) != NULL;
    fclose(f);
    if (ok) out[strcspn(out, "\r\n")] = 0;
    return ok;
}
static bool read_number(const char *path, unsigned long long *value) {
    char text[128], *end;
    if (!read_text(path, text, sizeof text) || !isdigit((unsigned char)text[0])) return false;
    errno = 0;
    *value = strtoull(text, &end, 10);
    while (isspace((unsigned char)*end)) end++;
    return !errno && end != text && !*end;
}
static void join(char *out, size_t size, const char *a, const char *b) {
    if (snprintf(out, size, "%s/%s", a, b) >= (int)size) out[0] = 0;
}
static void json_string(const char *value) {
    putchar('"');
    for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
        if (*p == '"' || *p == '\\') printf("\\%c", *p);
        else if (*p < 32) printf("\\u%04x", *p);
        else putchar(*p);
    }
    putchar('"');
}
static time_t now_seconds(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec;
}
static void discover(void) {
    glob_t matches = {0};
    cpu_count = 0;
    cpu_source[0] = amd_path[0] = 0;
    discovery_time = now_seconds();
    if (glob("/sys/class/hwmon/hwmon*", 0, NULL, &matches) != 0) { globfree(&matches); return; }
    for (size_t i = 0; i < matches.gl_pathc; i++) {
        char path[PATH_MAX], name[80];
        join(path, sizeof path, matches.gl_pathv[i], "name");
        if (!read_text(path, name, sizeof name)) continue;
        if (!strcmp(name, "amdgpu") && !amd_path[0])
            snprintf(amd_path, sizeof amd_path, "%s", matches.gl_pathv[i]);
        if (strcmp(name, "k10temp") && strcmp(name, "coretemp") && strcmp(name, "zenpower")) continue;
        size_t first = cpu_count;
        for (int t = 1; t <= 32 && cpu_count < 32; t++) {
            char file[48], label[80];
            snprintf(file, sizeof file, "temp%d_label", t);
            join(path, sizeof path, matches.gl_pathv[i], file);
            if (!read_text(path, label, sizeof label)) continue;
            if (strcmp(label, "Tctl") && strncmp(label, "Package id", 10)) continue;
            snprintf(file, sizeof file, "temp%d_input", t);
            join(cpu_paths[cpu_count++], PATH_MAX, matches.gl_pathv[i], file);
            snprintf(cpu_source, sizeof cpu_source, "%.40s / %.45s", name, label);
        }
        if (cpu_count == first && cpu_count < 32) {
            join(cpu_paths[cpu_count++], PATH_MAX, matches.gl_pathv[i], "temp1_input");
            snprintf(cpu_source, sizeof cpu_source, "%s", name);
        }
    }
    globfree(&matches);
}
static void nvml_open(void) {
    gpu.lib = dlopen("libnvidia-ml.so.1", RTLD_NOW | RTLD_LOCAL);
    if (!gpu.lib) return;
    gpu.init = dlsym(gpu.lib, "nvmlInit_v2");
    gpu.shutdown = dlsym(gpu.lib, "nvmlShutdown");
    gpu.handle = dlsym(gpu.lib, "nvmlDeviceGetHandleByIndex_v2");
    gpu.temperature = dlsym(gpu.lib, "nvmlDeviceGetTemperature");
    gpu.memory = dlsym(gpu.lib, "nvmlDeviceGetMemoryInfo");
    gpu.memory2 = dlsym(gpu.lib, "nvmlDeviceGetMemoryInfo_v2");
    gpu.name = dlsym(gpu.lib, "nvmlDeviceGetName");
    gpu.present = gpu.init && gpu.shutdown && gpu.handle && gpu.temperature && gpu.memory;
}
static void nvml_reconnect(void) {
    if (!gpu.present || gpu.device || now_seconds() < gpu.retry) return;
    gpu.retry = now_seconds() + 30;
    if (gpu.initialized) { gpu.shutdown(); gpu.initialized = false; }
    if (gpu.init() != 0) return;
    gpu.initialized = true;
    Device device = NULL;
    if (gpu.handle(0, &device) != 0) return;
    gpu.device = device;
    snprintf(gpu.label, sizeof gpu.label, "NVIDIA GPU");
    if (gpu.name) gpu.name(device, gpu.label, sizeof gpu.label);
    gpu.label[sizeof gpu.label - 1] = 0;
}
static void sample(void) {
    double cpu_temp = -1, gpu_temp = -1;
    unsigned long long total = 0, available = 0, used = 0, vtotal = 0, vused = 0;
    bool ram_ok = false, available_found = false, vram_ok = false;
    for (size_t i = 0; i < cpu_count; i++) {
        unsigned long long n;
        if (read_number(cpu_paths[i], &n) && n <= 150000 && n / 1000.0 > cpu_temp) cpu_temp = n / 1000.0;
    }
    if (cpu_temp < 0 && now_seconds() - discovery_time >= 30) discover();
    FILE *f = fopen("/proc/meminfo", "re");
    if (f) {
        char line[256];
        while (fgets(line, sizeof line, f)) {
            if (sscanf(line, "MemTotal: %llu kB", &total) == 1) continue;
            if (sscanf(line, "MemAvailable: %llu kB", &available) == 1) available_found = true;
        }
        fclose(f);
        ram_ok = total > 0 && available_found && available <= total;
        used = (total - (available <= total ? available : total)) * 1024;
        total *= 1024;
    }
    nvml_reconnect();
    if (gpu.device) {
        unsigned int temp = 0;
        int status = gpu.temperature(gpu.device, 0, &temp);
        if (status == 0 && temp <= 150) gpu_temp = temp;
        Memory2 mem2 = {.version = (unsigned int)sizeof(Memory2) | (2U << 24)};
        Memory mem = {0};
        int mem_status = gpu.memory2 ? gpu.memory2(gpu.device, &mem2) : -1;
        if (mem_status == 0) { vtotal = mem2.total; vused = mem2.used; }
        else {
            mem_status = gpu.memory(gpu.device, &mem);
            if (mem_status == 0) { vtotal = mem.total; vused = mem.used; }
        }
        vram_ok = mem_status == 0 && vtotal > 0 && vused <= vtotal;
        if (status == 15 || mem_status == 15 || (status != 0 && mem_status != 0)) gpu.device = NULL;
    } else if (!gpu.present && amd_path[0]) {
        char path[PATH_MAX]; unsigned long long n;
        join(path, sizeof path, amd_path, "temp1_input");
        if (read_number(path, &n) && n <= 150000) gpu_temp = n / 1000.0;
        join(path, sizeof path, amd_path, "device/mem_info_vram_total");
        bool ok = read_number(path, &vtotal);
        join(path, sizeof path, amd_path, "device/mem_info_vram_used");
        vram_ok = read_number(path, &vused) && ok && vtotal > 0 && vused <= vtotal;
        snprintf(gpu.label, sizeof gpu.label, "AMD GPU");
    }
    printf("{\"version\":1,\"cpuTemp\":");
    if (cpu_temp >= 0) printf("%.2f", cpu_temp); else printf("null");
    printf(",\"gpuTemp\":");
    if (gpu_temp >= 0) printf("%.0f", gpu_temp); else printf("null");
    printf(",\"ramUsed\":"); if (ram_ok) printf("%llu", used); else printf("null");
    printf(",\"ramTotal\":"); if (ram_ok) printf("%llu", total); else printf("null");
    printf(",\"vramUsed\":"); if (vram_ok) printf("%llu", vused); else printf("null");
    printf(",\"vramTotal\":"); if (vram_ok) printf("%llu", vtotal); else printf("null");
    printf(",\"cpuSource\":"); json_string(cpu_source);
    printf(",\"gpuName\":"); json_string(gpu.label);
    puts("}");
    fflush(stdout);
}
int main(int argc, char **argv) {
    pid_t parent = getppid();
    if (prctl(PR_SET_PDEATHSIG, SIGTERM) != 0 || getppid() != parent) return 1;
    setvbuf(stdout, NULL, _IOLBF, 0);
    discover();
    nvml_open();
    if (argc == 2 && !strcmp(argv[1], "--once")) sample();
    else if (argc == 1) {
        char command[32];
        while (fgets(command, sizeof command, stdin)) {
            if (!strcmp(command, "sample\n")) sample();
            else if (!strcmp(command, "quit\n")) break;
            else { fputs("Invalid command\n", stderr); break; }
        }
    } else { fputs("Usage: astro-sensors [--once]\n", stderr); return 2; }
    if (gpu.initialized) gpu.shutdown();
    if (gpu.lib) dlclose(gpu.lib);
    return ferror(stdout) ? 1 : 0;
}
