package com.bleattendance.ble

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * BleAdvertiserPackage
 * -----------------------------------------------------------------------------
 * Registers BleAdvertiserModule with React Native.
 *
 * This must be added in MainApplication.kt, inside getPackages():
 *
 *     import com.bleattendance.ble.BleAdvertiserPackage
 *
 *     override fun getPackages(): List<ReactPackage> =
 *         PackageList(this).packages.apply {
 *             add(BleAdvertiserPackage())
 *         }
 *
 * Forgetting this line is the most common setup mistake: the app builds and
 * runs fine, and the JavaScript then reports "Native module BleAdvertiser not
 * found" at runtime.
 *
 * This is a classic ("legacy") React Native module rather than a TurboModule.
 * Legacy modules continue to work under the New Architecture through the
 * bridgeless interop layer, so nothing extra is required for RN 0.76+.
 * -----------------------------------------------------------------------------
 */
class BleAdvertiserPackage : ReactPackage {

    /**
     * ReactPackage.createNativeModules carries an @Deprecated marker in RN 0.87,
     * pointing at BaseReactPackage.getModule() as the eventual replacement.
     *
     * It is still the path PackageList and the bridgeless interop layer use for
     * a plain ReactPackage, and it works correctly, so this stays as-is for now.
     * Migrating means switching to BaseReactPackage and supplying a
     * ReactModuleInfoProvider - a change to how the module is REGISTERED at
     * runtime, which is worth doing only once end-to-end BLE detection is
     * confirmed working, so a registration regression cannot be confused with a
     * Bluetooth problem.
     *
     * The suppression is for OVERRIDE_DEPRECATION specifically (overriding a
     * deprecated member without being deprecated ourselves), not for calling
     * anything deprecated.
     */
    @Suppress("OVERRIDE_DEPRECATION")
    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): List<NativeModule> = listOf(BleAdvertiserModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> = emptyList()
}
