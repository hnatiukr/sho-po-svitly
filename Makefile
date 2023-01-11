.PHONY: build dev ci bot-stop bot-restart bot-status bot-service bot-log

install:
	npm ci

build:
	npx prettier --loglevel error --write .
	rm -rf bot
	npx tsc -p tsconfig.build.json

dev:
	make build
	node bot

ci:
	make bot-stop
	git pull origin main
	rm -rf node_modules/
	make install build bot-restart bot-status

bot-stop:
	sudo systemctl stop bot

bot-restart:
	sudo systemctl daemon-reload
	sudo systemctl enable bot
	sudo systemctl start bot

bot-status:
	sudo systemctl status bot

bot-service:
	sudo nano /etc/systemd/system/bot.service

bot-log:
	sudo tail -30 /var/log/syslog
