package com.bleattendance.files

import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * FileShareModule
 * -----------------------------------------------------------------------------
 * Writes a base64 payload to the app's cache and opens the system share sheet
 * for it. Used by the monthly attendance export.
 *
 * WHY A MODULE RATHER THAN A LIBRARY
 * ----------------------------------
 * This app already owns a native module and a working Gradle setup. Pulling in
 * a share library for one 40-line operation would add another native dependency
 * to an app whose BLE stack is deliberately kept stable — the risk is not worth
 * the convenience.
 *
 * SCOPE
 * -----
 * Files land in cacheDir/reports and are exposed through a FileProvider limited
 * to that one directory (see file_share_paths.xml). The chooser target receives
 * a temporary read grant for a single file; nothing else is reachable. Cache is
 * the right home: the exported report is a derived artefact, and Android may
 * reclaim it whenever it likes without losing anything that is not regenerable
 * from the attendance records.
 * -----------------------------------------------------------------------------
 */
class FileShareModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val MODULE_NAME = "FileShare"
        private const val E_WRITE = "E_WRITE"
        private const val E_NO_ACTIVITY = "E_NO_ACTIVITY"
        private const val E_BAD_NAME = "E_BAD_NAME"

        /** Defence against a caller trying to escape the reports directory. */
        private val SAFE_NAME = Regex("^[A-Za-z0-9._-]{1,120}$")
    }

    override fun getName(): String = MODULE_NAME

    /**
     * Write [base64] as [fileName] and present the share sheet.
     *
     * Resolves true when the chooser was launched, false when the user has no
     * app able to receive the file. Rejects only on genuine failures, so the JS
     * side can tell "nothing to share with" apart from "the export broke".
     */
    @ReactMethod
    fun shareBase64File(base64: String, fileName: String, mimeType: String, promise: Promise) {
        if (!SAFE_NAME.matches(fileName)) {
            promise.reject(E_BAD_NAME, "Unsafe file name: $fileName")
            return
        }

        val activity = reactContext.currentActivity
        if (activity == null) {
            // The chooser is an Activity result; there is no Context fallback.
            promise.reject(E_NO_ACTIVITY, "No foreground activity available to show the share sheet.")
            return
        }

        val file: File
        try {
            val dir = File(reactContext.cacheDir, "reports")
            if (!dir.exists() && !dir.mkdirs()) {
                promise.reject(E_WRITE, "Could not create the reports directory.")
                return
            }

            // One report at a time: clear previous exports so the cache does not
            // accumulate a month of stale workbooks.
            dir.listFiles()?.forEach { it.delete() }

            file = File(dir, fileName)
            file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
        } catch (e: Exception) {
            promise.reject(E_WRITE, "Could not write the report file: ${e.message}")
            return
        }

        try {
            val uri = FileProvider.getUriForFile(
                reactContext,
                "${reactContext.packageName}.fileshare",
                file,
            )

            val send = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TITLE, fileName)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            val chooser = Intent.createChooser(send, "Save or share report").apply {
                // The chooser itself is started from an Activity, but the grant
                // has to ride along or targets get a SecurityException on read.
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            if (send.resolveActivity(reactContext.packageManager) == null) {
                promise.resolve(false)
                return
            }

            activity.startActivity(chooser)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(E_WRITE, "Could not open the share sheet: ${e.message}")
        }
    }
}
