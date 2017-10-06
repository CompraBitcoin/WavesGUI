(function () {
    'use strict';

    const factory = function () {

        class State {

            constructor() {
                /**
                 * @type {boolean}
                 */
                this.windowStateFocus = true;
                /**
                 * @type {{window: {blur: Signal, focus: Signal}, sleep: Signal, wakeUp: Signal}}
                 */
                this.signals = {
                    window: {
                        blur: new tsUtils.Signal(),
                        focus: new tsUtils.Signal()
                    },
                    sleep: new tsUtils.Signal(),
                    wakeUp: new tsUtils.Signal()
                };

                this._timer = null;
                this._seepStartTime = null;
                this._maxSleep = null;
                this._seepStep = null;
                this._block = document.createElement('DIV');
                this._handlers = Object.create(null);

                this._initialize();
            }

            setMaxSleep(max) {
                this._maxSleep = max;
            }

            /**
             * @private
             */
            _initialize() {
                this._addBlockStyles();
                this._createHandlers();
                this._setHandlers();
            }

            _addBlockStyles() {
                this._block.classList.add('sleep-block');
            }

            /**
             * @private
             */
            _createHandlers() {
                this._handlers.focus = () => {
                    this.windowStateFocus = true;
                    this.signals.window.focus.dispatch();
                    this._wakeUp();
                };
                this._handlers.blur = () => {
                    this.windowStateFocus = false;
                    this.signals.window.blur.dispatch();
                    this._sleep();
                };
            }

            _wakeUp() {
                this._seepStartTime = null;
                this._seepStep = null;
                if (this._timer) {
                    clearTimeout(this._timer);
                    this._timer = null;
                }
                if (this._block.parentNode === document.body) {
                    document.body.removeChild(this._block);
                }
                this.signals.wakeUp.dispatch();
            }

            _sleep() {
                if (this._timer) {
                    this._timer = null;
                }
                if (!this._seepStartTime) {
                    if (this._maxSleep) {
                        document.body.appendChild(this._block);
                    }
                    this._seepStartTime = Date.now();
                    this._setSleepStep(0);
                }
                this._timer = setTimeout(() => {
                    this._timer = null;
                    const time = Date.now() - this._seepStartTime;
                    const sleepMinutes = Math.floor(time / (1000 * 60 * 5));
                    this._setSleepStep(sleepMinutes);
                    this._sleep();
                }, 1000);
            }

            _setSleepStep(step) {
                if (this._seepStep === step) {
                    return null;
                }
                this._seepStep = step;
                if (this._maxSleep) {
                    this._block.style.opacity = this._seepStep * (1 / this._maxSleep);
                }
                this.signals.sleep.dispatch(this._seepStep);
            }

            /**
             * @private
             */
            _setHandlers() {
                Object.keys(this._handlers)
                    .forEach((event) => {
                        window.addEventListener(event, this._handlers[event], false);
                    });
            }
        }

        return new State();
    };

    factory.$inject = [];

    angular.module('app')
        .factory('state', factory);
})();
