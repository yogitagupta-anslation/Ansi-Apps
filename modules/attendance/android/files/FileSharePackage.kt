package com.bleattendance.files

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * FileSharePackage
 * -----------------------------------------------------------------------------
 * Registers FileShareModule. Added in MainApplication.getPackages() alongside
 * BleAdvertiserPackage; see that file for why these are classic ReactPackages
 * rather than TurboModules.
 * -----------------------------------------------------------------------------
 */
class FileSharePackage : ReactPackage {

    @Suppress("OVERRIDE_DEPRECATION")
    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): List<NativeModule> = listOf(FileShareModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> = emptyList()
}
