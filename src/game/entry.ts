interface XRLauncher {
  launchXR(): void;
  readonly session: unknown;
  readonly sessionRequestPending: boolean;
}

/** IWSDK launches asynchronously but returns void and logs permission failures. */
export function enterXR(world: XRLauncher): Promise<void> {
  // Keep the request inside the click's user activation, before any await.
  world.launchXR();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (world.session) resolve();
      else if (!world.sessionRequestPending) reject(new Error('Headset entry was cancelled or unavailable. Check XR permissions in your browser.'));
      else setTimeout(check, 50);
    };
    check();
  });
}
