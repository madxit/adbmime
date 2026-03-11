package it.adbmime.demo.view

import javafx.scene.input.MouseEvent

object RemotePointJavaFx {
    fun getX(e: MouseEvent): Int = e.x.toInt()
    fun getY(e: MouseEvent): Int = e.y.toInt()
}
