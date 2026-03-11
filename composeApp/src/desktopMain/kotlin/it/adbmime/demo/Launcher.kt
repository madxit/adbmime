package it.adbmime.demo

import javafx.application.Application

object Launcher {
    @JvmStatic
    fun main(args: Array<String>) {
        Application.launch(App::class.java, *args)
    }
}
