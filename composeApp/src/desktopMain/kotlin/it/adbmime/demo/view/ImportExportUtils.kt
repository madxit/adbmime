package it.adbmime.demo.view

import it.adbmime.demo.AdbMimeController
import it.adbmime.utils.*
import javafx.collections.ObservableList
import javafx.stage.FileChooser
import java.io.File

object ImportExportUtils {
    fun exportRows(controller: AdbMimeController, data: ObservableList<RemoteInputTableViewRow>) {
        // Mocking export for now
        println("Exporting ${data.size} rows")
    }

    fun importRows(controller: AdbMimeController, data: ObservableList<RemoteInputTableViewRow>) {
        // Mocking import for now
        println("Importing rows")
    }

    fun installApk(controller: AdbMimeController, data: ObservableList<RemoteInputTableViewRow>) {
        val fileChooser = FileChooser()
        fileChooser.extensionFilters.add(FileChooser.ExtensionFilter("APK Files", "*.apk"))
        val file = fileChooser.showOpenDialog(null)
        if (file != null) {
            val remoteInput = RemoteInputAppInstall(file.absolutePath)
            data.add(RemoteInputTableViewRow.getInstance(remoteInput))
            // controller.send(remoteInput) // Optional: send immediately?
        }
    }
}
