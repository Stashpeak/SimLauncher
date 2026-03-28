const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        resizable: true,
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'SimLauncher.ico'),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function isValidExePath(p) {
    return typeof p === 'string' && p.trim().length > 0 && /\.exe$/i.test(p.trim());
}

// ----------------------------------------------------------------
// MAIN LAUNCH LOGIC
// ----------------------------------------------------------------

/**
 * Executes a list of applications sequentially with a delay.
 * @param {string[]} profileApps Array of executable paths to launch.
 */
ipcMain.handle('launch-profile', (event, profileApps) => {
    if (!Array.isArray(profileApps) || profileApps.length === 0) {
        return { success: false, error: 'Profile is empty.' };
    }

    let delay = 0;
    profileApps.forEach((appPath) => {
        if (!isValidExePath(appPath)) {
            console.error(`Skipping invalid path: ${appPath}`);
            return;
        }
        setTimeout(() => {
            const child = spawn(appPath, [], { detached: true, stdio: 'ignore' });
            child.on('error', (err) => {
                console.error(`Error launching ${appPath}: ${err.message}`);
                event.sender.send('app-launch-error', { app: appPath, error: err.message });
            });
            child.unref();
        }, delay);
        delay += 1000; // 1 second delay between app launches for stability
    });

    return { success: true, message: 'All profile applications launching.' };
});


// ----------------------------------------------------------------
// FILE BROWSER DIALOG LISTENER
// ----------------------------------------------------------------

/**
 * Opens a file dialog to select an executable file and sends the path back.
 * @param {string} inputId The ID of the input field in the Renderer to update.
 */
ipcMain.handle('browse-path', async (event, inputId) => {
    try {
        const result = await dialog.showOpenDialog(null, {
            title: 'Select Executable File (.exe)',
            properties: ['openFile'],
            filters: [
                { name: 'Executable Files', extensions: ['exe'] }
            ]
        });
        if (!result.canceled && result.filePaths.length > 0) {
            return { filePath: result.filePaths[0], inputId };
        }
        return { filePath: null, inputId };
    } catch (err) {
        console.error("Dialog error:", err);
        return { filePath: null, inputId };
    }
});
