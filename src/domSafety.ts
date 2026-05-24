const PATCH_FLAG = '__webgisDomSafetyInstalled';

type PatchedWindow = Window & {
  [PATCH_FLAG]?: boolean;
};

export function installDomSafetyPatch() {
  const patchedWindow = window as PatchedWindow;
  if (patchedWindow[PATCH_FLAG]) return;
  patchedWindow[PATCH_FLAG] = true;

  const nativeRemoveChild = Node.prototype.removeChild;

  Node.prototype.removeChild = function removeChild<T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      return child;
    }

    return nativeRemoveChild.call(this, child) as T;
  };
}
