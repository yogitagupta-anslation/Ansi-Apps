package com.eventpulse.ble

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

/**
 * Registers the BLE module with React Native.
 *
 * The Expo config plugin (`plugins/withEventPulseBle.js`) inserts
 * `packages.add(EventPulseBlePackage())` into the generated MainApplication, so
 * `expo prebuild` produces a project with this already wired up.
 */
class EventPulseBlePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(EventPulseBleModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<out View, out ReactShadowNode<*>>> = emptyList()
}
