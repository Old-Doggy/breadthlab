PY ?= python
.PHONY: bootstrap update marts status export briefing test lint dev all

bootstrap:
	$(PY) -m pipeline.bootstrap

update:
	$(PY) -m pipeline.update_daily

marts:
	$(PY) -m pipeline.build_marts

status:
	$(PY) -m pipeline.refresh_status

export:
	$(PY) -m pipeline.export_static

briefing:
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/briefing.ps1

test:
	$(PY) -m pytest

lint:
	$(PY) -m ruff check --select E9,F63,F7,F82 .

dev:
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1

all: update marts status export briefing
