package it.adbmime.demo

import java.io.IOException

class AboutController {
    fun openPrimary() {
        try {
            App.setRoot("adbmime")
        } catch (e: IOException) {
            e.printStackTrace()
        }
    }

    fun openLink() {
        // Mocking link open for now
        println("Opening link: https://github.com/madxit/adbmime")
    }
}
