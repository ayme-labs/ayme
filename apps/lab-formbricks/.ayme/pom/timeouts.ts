/**
 * How long an action waits for the screen it leads to. Ayme's own limit for
 * a click or a fill is one second, which a screen that Formbricks has to
 * save, load or compile first does not meet.
 */
export const NEXT_SCREEN_TIMEOUT = 10_000;
