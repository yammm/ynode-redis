/**
 * Races a promise against a deadline. The timer is unref'd so a pending
 * deadline never keeps the process alive, and the operation's eventual
 * settlement is always consumed so a late rejection cannot become an
 * unhandled rejection.
 * @param {Promise<*>} promise - Operation to bound.
 * @param {number} timeoutMs - Deadline in milliseconds.
 * @param {function(): Error} createTimeoutError - Factory for the deadline error.
 * @returns {Promise<*>} Settles with the operation, or rejects with the deadline error.
 */
export function raceWithDeadline(promise, timeoutMs, createTimeoutError) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(createTimeoutError()), timeoutMs);
        timer.unref?.();
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}
