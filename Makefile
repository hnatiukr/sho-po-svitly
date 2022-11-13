.PHONY: lint prebuild build start dev ci service ci

install:
	npm install

lint:
	npx prettier --loglevel error --write .

prebuild:
	rm -rf bot

build:
	make prebuild
	npx tsc -p tsconfig.build.json

start:
	node bot

dev:
	make lint prebuild build start

service:
	sudo systemctl daemon-reload
	sudo systemctl enable bot
	sudo systemctl start bot
	sudo systemctl status bot

ci:
	git pull
	make install prebuild build service