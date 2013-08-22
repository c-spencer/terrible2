test:
	@NODE_ENV=test ./node_modules/.bin/mocha

test-watch:
	@NODE_ENV=test ./node_modules/.bin/mocha -w -R min

test-cov:
	@NODE_ENV=test ./node_modules/.bin/mocha -r blanket -R html-cov > coverage.html

watchify:
	./node_modules/.bin/watchify -t brfs lib/environment.js -s Terrible -o repl/environment-browser.js

.PHONY: test test-cov
