.PHONY: lint prebuild build start dev ci service ci

install:
	npm ci

lint:
	npx prettier --loglevel error --write .

prebuild:
	rm -rf bot

build:
	make prebuild
	npx tsc -p tsconfig.build.json

dev:
	make lint build
	node bot

stop:
	sudo systemctl stop bot

restart:
	sudo systemctl daemon-reload
	sudo systemctl enable bot
	sudo systemctl start bot
	sudo systemctl status bot

ci:
	make stop
	git pull --rebase origin main
	make install build
	make restart

log:
	sudo tail -30 /var/log/syslog
