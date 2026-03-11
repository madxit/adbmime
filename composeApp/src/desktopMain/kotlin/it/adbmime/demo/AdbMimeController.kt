package it.adbmime.demo

import it.adbmime.demo.view.Device
import it.adbmime.demo.view.DeviceTableViewRow
import it.adbmime.demo.view.ImportExportUtils
import it.adbmime.demo.view.RemoteInputTableViewRow
import it.adbmime.demo.view.RemotePointJavaFx
import it.adbmime.utils.*
import javafx.collections.FXCollections
import javafx.collections.ObservableList
import javafx.event.ActionEvent
import javafx.fxml.FXML
import javafx.scene.Node
import javafx.scene.control.*
import javafx.scene.image.ImageView
import javafx.scene.input.MouseEvent
import javafx.scene.layout.StackPane
import javafx.util.Callback
import java.io.IOException

class AdbMimeController {
    @FXML lateinit var inputKeyChoiceBox: ChoiceBox<RemoteInputType>
    @FXML lateinit var imageView: ImageView
    @FXML lateinit var textField: TextField
    @FXML lateinit var stackPaneForImage: StackPane
    @FXML lateinit var remoteInputsTable: TableView<RemoteInputTableViewRow>
    @FXML lateinit var iconColumn: TableColumn<RemoteInputTableViewRow, String>
    @FXML lateinit var typeColumn: TableColumn<RemoteInputTableViewRow, String>
    @FXML lateinit var cmndColumn: TableColumn<RemoteInputTableViewRow, String>
    @FXML lateinit var replayCommandsSleepSpinner: Spinner<Integer>
    @FXML lateinit var replayOnAllDevicesCommandsButton: Button
    @FXML lateinit var replayCommandsButton: Button
    @FXML lateinit var deleteTableRowsButton: Button
    @FXML lateinit var deleteTableRowButton: Button
    @FXML lateinit var exportTableRowsButton: Button
    @FXML lateinit var importTableRowsButton: Button
    @FXML lateinit var ip1Spinner: Spinner<Int>
    @FXML lateinit var ip2Spinner: Spinner<Int>
    @FXML lateinit var ip3Spinner: Spinner<Int>
    @FXML lateinit var ip4Spinner: Spinner<Int>
    @FXML lateinit var portSpinner: Spinner<Int>
    @FXML lateinit var textFieldPackageName: TextField
    @FXML lateinit var appButtonInstall: Button
    @FXML lateinit var appButtonOpen: Button
    @FXML lateinit var appButtonUnInstall: Button
    @FXML lateinit var appButtonHide: Button
    @FXML lateinit var appButtonUnHide: Button
    @FXML lateinit var devicesTable: TableView<DeviceTableViewRow>
    @FXML lateinit var devicesStatusColumn: TableColumn<DeviceTableViewRow, String>
    @FXML lateinit var devicesIdColumn: TableColumn<DeviceTableViewRow, String>

    private val remoteInputsData: ObservableList<RemoteInputTableViewRow> = FXCollections.observableArrayList()
    private val devicesData: ObservableList<DeviceTableViewRow> = FXCollections.observableArrayList()

    fun send(remoteInput: RemoteInput): RemoteInput {
        val deviceRow = devicesTable.selectionModel.selectedItem
        if (deviceRow == null) {
            val devices = AdbHelper.getConnectedDevices()
            if (devices.isNotEmpty()) {
                remoteInput.send(devices[0])
            }
        } else {
            remoteInput.send(deviceRow.device.id)
        }
        return remoteInput
    }

    @FXML
    fun initialize() {
        inputKeyChoiceBox.items.addAll(RemoteInputType.RemoteInputKeycode, RemoteInputType.RemoteInputUnknown) // Simplification for now
        
        imageView.fitWidthProperty().bind(stackPaneForImage.widthProperty().subtract(10))
        imageView.fitHeightProperty().bind(stackPaneForImage.heightProperty().subtract(10))

        setupTableViewForDevices()
        setupTableViewForRemoteInputs()

        textFieldPackageName.textProperty().addListener { _, _, newValue ->
            val disable = newValue.isNullOrEmpty()
            appButtonOpen.isDisable = disable
            appButtonUnInstall.isDisable = disable
            appButtonHide.isDisable = disable
            appButtonUnHide.isDisable = disable
        }
    }

    private fun setupTableViewForDevices() {
        devicesStatusColumn.cellValueFactory = Callback { it.value.getStatusProp() }
        devicesIdColumn.cellValueFactory = Callback { it.value.getIdProp() }
        devicesTable.items = devicesData
    }

    private fun setupTableViewForRemoteInputs() {
        iconColumn.cellValueFactory = Callback { it.value.getIconProp() }
        typeColumn.cellValueFactory = Callback { it.value.getTypeProp() }
        cmndColumn.cellValueFactory = Callback { it.value.getCmndProp() }
        remoteInputsTable.items = remoteInputsData
    }

    @FXML fun exportTableRows() = ImportExportUtils.exportRows(this, remoteInputsData)
    @FXML fun importTableRows() = ImportExportUtils.importRows(this, remoteInputsData)
    @FXML fun deleteTableRows() = remoteInputsData.clear()
    
    @FXML fun deleteTableRow() {
        val selected = remoteInputsTable.selectionModel.selectedItems.toList()
        remoteInputsData.removeAll(selected)
    }

    @FXML
    fun onReplayCommandsButtonClick() {
        Thread {
            setDisabledForActions(true)
            remoteInputsData.forEach { row ->
                send(row.remoteInput)
                Thread.sleep(1000L * replayCommandsSleepSpinner.value.toLong())
            }
            setDisabledForActions(false)
        }.start()
    }

    @FXML
    fun onReplayOnAllDevicesCommandsButtonClick() {
        Thread {
            setDisabledForActions(true)
            remoteInputsData.forEach { row ->
                devicesData.forEach { deviceRow ->
                    row.remoteInput.send(deviceRow.device.id)
                }
                Thread.sleep(1000L * replayCommandsSleepSpinner.value.toLong())
            }
            setDisabledForActions(false)
        }.start()
    }

    private fun setDisabledForActions(disabled: Boolean) {
        replayCommandsSleepSpinner.isDisable = disabled
        replayOnAllDevicesCommandsButton.isDisable = disabled
        replayCommandsButton.isDisable = disabled
    }

    @FXML fun openAbout() = App.setRoot("about")

    private var startTime: Long = 0
    @FXML fun onKeyPressedAction() { startTime = System.currentTimeMillis() }

    @FXML
    fun onKeyReleasedActionSimple(event: MouseEvent) {
        val node = event.source as Node
        val keycode = (node.userData as String).toInt()
        val input = RemoteInputKeycode(keycode)
        remoteInputsData.add(RemoteInputTableViewRow.getInstance(send(input)))
    }

    @FXML
    fun onKeyReleasedActionChoiceBox(event: MouseEvent) {
        val type = inputKeyChoiceBox.selectionModel.selectedItem
        if (type != null) {
            val input = RemoteInputKeycode(type.ordinal) // This might need refinement based on how codes are mapped
            remoteInputsData.add(RemoteInputTableViewRow.getInstance(send(input)))
        }
    }

    @FXML fun onScreenUpdateButtonClick() {
        // Mocking screen update for now - requires image conversion logic
    }

    @FXML fun textFieldAction(ae: ActionEvent) {
        val input = RemoteInputText(textField.text)
        remoteInputsData.add(RemoteInputTableViewRow.getInstance(send(input)))
    }

    private var lastMousePressed: MouseEvent? = null
    @FXML fun onMousePressedAction(e: MouseEvent) { lastMousePressed = e }
    @FXML
    fun onMouseReleasedAction(e: MouseEvent) {
        val last = lastMousePressed ?: return
        if (last.x == e.x && last.y == e.y) {
            val input = RemoteInputTap(e.x.toInt(), e.y.toInt())
            remoteInputsData.add(RemoteInputTableViewRow.getInstance(send(input)))
        } else {
            val input = RemoteInputSwipe(last.x.toInt(), last.y.toInt(), e.x.toInt(), e.y.toInt())
            remoteInputsData.add(RemoteInputTableViewRow.getInstance(send(input)))
        }
    }

    @FXML fun onInstallApp() = ImportExportUtils.installApk(this, remoteInputsData)
    @FXML fun onOpenApp() = addAppCommand { RemoteInputAppOpen(it) }
    @FXML fun onHideApp() = addAppCommand { RemoteInputAppHide(it) }
    @FXML fun onUnHideApp() = addAppCommand { RemoteInputAppUnhide(it) }
    @FXML fun onUninstallApp() = addAppCommand { RemoteInputAppUninstall(it) }

    private fun addAppCommand(factory: (String) -> RemoteInput) {
        val pkg = textFieldPackageName.text
        if (!pkg.isNullOrEmpty()) {
            remoteInputsData.add(RemoteInputTableViewRow.getInstance(send(factory(pkg))))
        }
    }

    @FXML
    fun onListDevices() {
        val devices = AdbHelper.getConnectedDevices()
        devicesData.clear()
        devicesData.addAll(devices.map { DeviceTableViewRow.getInstance(it, "device") })
    }

    @FXML
    fun onConnectDevices() {
        val ip = "${ip1Spinner.value}.${ip2Spinner.value}.${ip3Spinner.value}.${ip4Spinner.value}:${portSpinner.value}"
        AdbHelper.runAdbCommand("", "connect", ip)
        onListDevices()
    }

    @FXML
    fun onDisconnectDevices() {
        AdbHelper.runAdbCommand("", "disconnect")
        onListDevices()
    }
}
