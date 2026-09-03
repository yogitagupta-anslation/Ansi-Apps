/**
 * Register hand-written ReactPackages in the generated MainApplication.
 *
 * Shared by both native plugins because both had independently hard-coded the
 * same anchor — `val packages = PackageList(this).packages` — which is the Expo
 * SDK 50-era template and is not what SDK 57 generates. SDK 57 builds the list
 * inline instead:
 *
 *   packageList =
 *     PackageList(this).packages.apply {
 *       // add(MyReactNativePackage())
 *     }
 *
 * Rather than pin the plugins to one template, this tries each known shape in
 * turn and throws with a useful message if none matches — which is the signal
 * that a future SDK bump changed the file again.
 */

/** `.apply { ... }` on the autolinked list — Expo SDK 57. */
const APPLY_ANCHOR = 'PackageList(this).packages.apply {';
/** Kotlin template, Expo SDK 50-56. */
const KOTLIN_ANCHOR = 'val packages = PackageList(this).packages';
/** Java template, older still. */
const JAVA_ANCHOR = 'List<ReactPackage> packages = new PackageList(this).getPackages();';

/**
 * @param {string} contents  MainApplication source.
 * @param {string[]} packages  Fully-qualified ReactPackage class names.
 * @param {string} pluginName  Used only in the error message.
 * @returns {string} the source with any missing packages registered.
 */
function addReactPackages(contents, packages, pluginName) {
  for (const reactPackage of packages) {
    // Idempotent: prebuild without --clean re-runs the mods over a file that may
    // already carry these lines.
    if (contents.includes(`${reactPackage}()`)) continue;

    if (contents.includes(APPLY_ANCHOR)) {
      contents = contents.replace(APPLY_ANCHOR, `${APPLY_ANCHOR}\n          add(${reactPackage}())`);
      continue;
    }
    if (contents.includes(KOTLIN_ANCHOR)) {
      contents = contents.replace(
        KOTLIN_ANCHOR,
        `${KOTLIN_ANCHOR}\n              packages.add(${reactPackage}())`,
      );
      continue;
    }
    if (contents.includes(JAVA_ANCHOR)) {
      contents = contents.replace(
        JAVA_ANCHOR,
        `${JAVA_ANCHOR}\n          packages.add(new ${reactPackage}());`,
      );
      continue;
    }

    throw new Error(
      `${pluginName}: could not find the package list in MainApplication — the Expo ` +
        `template has changed shape again. Register ${reactPackage}() manually, or ` +
        'teach plugins/addReactPackages.js the new anchor.',
    );
  }

  return contents;
}

module.exports = { addReactPackages };
