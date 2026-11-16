CC ?= cc
CFLAGS ?= -O2
CFLAGS += -std=c11 -Wall -Wextra -Werror -Wformat=2 -Wshadow -fstack-protector-strong -D_FORTIFY_SOURCE=2
LDFLAGS += -Wl,-z,relro,-z,now

.PHONY: all test clean
all: astro-sensors schemas/gschemas.compiled

astro-sensors: native/sensors.c
	$(CC) $(CFLAGS) $< -o $@ $(LDFLAGS) -ldl

schemas/gschemas.compiled: schemas/org.gnome.shell.extensions.astro-vitals.gschema.xml
	glib-compile-schemas --strict schemas

test: all
	gjs -m tests/model.test.js
	python3 tests/helper.py

clean:
	rm -f astro-sensors schemas/gschemas.compiled
