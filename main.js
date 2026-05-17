require('dotenv').config();

const {
  app, BrowserWindow, Tray, globalShortcut, ipcMain,
  nativeImage, screen, shell, clipboard, Notification,
} = require('electron');
const path      = require('path');
const fs        = require('fs');

const configSvc  = require('./services/config');
const claude     = require('./services/claude');
const voice      = require('./services/voice');
const wakeWord   = require('./services/wakeword');
const gmail      = require('./services/gmail');
const calendar   = require('./services/calendar');
const memory     = require('./services/memory');
const files      = require('./services/files');
const sysInfo    = require('./services/system');
const osCtrl     = require('./services/os-control');
const screen_    = require('./services/screen');
const clipHist   = require('./services/clipboard-history');
const focus      = require('./services/focus');
const proactive  = require('./services/proactive');
const notifs     = require('./services/notifications');
const perms      = require('./services/permissions');
const updater    = require('./services/updater');
const license    = require('./services/license');
const wsbridge   = require('./services/wsbridge');
// New integrations
const imessage   = require('./services/imessage');
const contacts   = require('./services/contacts');
const notes      = require('./services/notes');
const reminders  = require('./services/reminders');
const photos     = require('./services/photos');
const safari     = require('./services/safari');
const notion     = require('./services/notion');
const obsidian   = require('./services/obsidian');
const weather    = require('./services/weather');
const search     = require('./services/search');
const newsService = require('./services/news');
const stocks     = require('./services/stocks');
const crypto     = require('./services/crypto');
const wikipedia  = require('./services/wikipedia');
const icloudMail = require('./services/icloud-mail');

let mainWindow      = null;
let onboardingWindow = null;
let tray            = null;
const isDev    = process.env.NODE_ENV === 'development';
const history  = memory.loadHistory();

gmail.setOpenUrl((url) => shell.openExternal(url));

// ── Clipboard monitor ──────────────────────────────────────────────────────
setInterval(() => {
  try { clipHist.update(clipboard.readText()); } catch {}
}, 1000);

// ── Confirmation gate ──────────────────────────────────────────────────────
// For dangerous operations, we pause tool execution and ask the user in-chat.

let _confirmResolve = null;
let _confirmReject  = null;

function requestConfirmation(message, detail) {
  return new Promise((resolve, reject) => {
    _confirmResolve = resolve;
    _confirmReject  = reject;
    mainWindow.webContents.send('jarvis-confirm', { message, detail });
  });
}

ipcMain.on('confirm-action', (_e, confirmed) => {
  if (confirmed)  _confirmResolve?.();
  else            _confirmReject?.(new Error('Vom User abgebrochen.'));
  _confirmResolve = _confirmReject = null;
});

// ── Window ─────────────────────────────────────────────────────────────────

// ── Window ────────────────────────────────────────────────────────────────
// JARVIS Electron is now a background process. The visible UI is the
// 300×60 floating indicator (pulse dot + "JARVIS" wordmark). Everything
// chat / HUD / map related lives at daylens.dev/brain and talks to this
// process via the WebSocket bridge.
const INDICATOR_W = 300;
const INDICATOR_H = 60;
let _windowMode = 'indicator';  // kept so existing setWindowMode calls don't crash

function createWindow() {
  const work = screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({
    width:  INDICATOR_W,
    height: INDICATOR_H,
    x: work.x + work.width - INDICATOR_W - 16,
    y: work.y + 16,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'assets', 'jarvis.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  // Float above full-screen apps too.
  try { mainWindow.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  try { mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  // Reset the "activated by wake-word" gate whenever the user moves away
  // from JARVIS. The next wake-word detection is then allowed to focus us
  // again; further detections while we still hold focus are ignored.
  mainWindow.on('blur', () => { _wasActivatedByWakeWord = false; });

  // Diagnostic only — we used to gate IPC on these but it caused IPCs
  // to be permanently buffered after spurious 'render-process-gone' events.
  mainWindow.webContents.on('did-finish-load', () => console.log('[Renderer] did-finish-load'));
  mainWindow.webContents.on('render-process-gone', (_e, d) => console.warn('[Renderer] render-process-gone:', d.reason, JSON.stringify(d)));
  mainWindow.webContents.on('preload-error', (_e, prelPath, err) => console.error('[Renderer] preload-error:', prelPath, err));
  // Mirror renderer console into main terminal so we can see what JS is dying.
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const levels = ['debug', 'log', 'warn', 'error'];
    const lvl = levels[level] || 'log';
    if (lvl === 'error' || lvl === 'warn' || message.includes('error') || message.includes('Error')) {
      console.log(`[RendererConsole:${lvl}] ${message}  @ ${sourceId}:${line}`);
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // DevTools auto-open turned off — open with Cmd+Opt+I when needed.
    // Show after ready-to-show (post first paint, less GPU contention than
    // did-finish-load which fires before AudioContext + initial paint settle).
    mainWindow.once('ready-to-show', () => {
      setTimeout(() => { if (!mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } }, 200);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

// Indicator window has a fixed size; mode-switching from the old multi-mode
// UI is now a no-op kept only so legacy IPC callers (wake-word callback,
// `set-window-mode` from anywhere) don't error out.
function setWindowMode(_mode) {
  return { ok: true, mode: 'indicator', noop: true };
}

// ── Tray ───────────────────────────────────────────────────────────────────

function createTray() {
  if (tray) { tray.destroy(); tray = null; }
  // Use @2x icon for retina displays, fall back to 1x
  const icon2x = path.join(__dirname, 'assets', 'tray-icon@2x.png');
  const icon1x = path.join(__dirname, 'assets', 'tray-icon.png');
  const iconPath = fs.existsSync(icon2x) ? icon2x : icon1x;

  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(icon1x);
  }
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAAa/KRFAAAAGklEQVR42mNk+A8AAwAB/gD3qQAAAABJRU5ErkJggg=='
    );
  }

  // Retina: set the image as template with correct DPI
  if (fs.existsSync(icon2x)) {
    icon = nativeImage.createFromPath(icon1x);
    icon.addRepresentation({ scaleFactor: 2.0, dataURL: nativeImage.createFromPath(icon2x).toDataURL() });
  }

  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('JARVIS');
  tray.on('click', toggleWindow);
}

function showWindow() {
  // Only re-center when the window was hidden — otherwise we'd snap the
  // window back to center every wake-word hit, which feels jarring if the
  // user has moved it.
  if (!mainWindow.isVisible()) {
    mainWindow.center();
    mainWindow.show();
  }
  mainWindow.focus();
}
function toggleWindow() { mainWindow.isVisible() ? mainWindow.hide() : showWindow(); }

// ── Tool executor ──────────────────────────────────────────────────────────

async function toolExecutor(name, input) {
  const g = gmail.isConfigured() && gmail.isAuthenticated();

  switch (name) {
    // Gmail
    case 'get_emails':            return g ? gmail.getEmails(input)         : noGoogle();
    case 'get_email_content':     return g ? gmail.getEmailContent(input)    : noGoogle();
    case 'send_email':            return g ? gmail.sendEmail(input)          : noGoogle();
    // Calendar
    case 'get_calendar_events':   return g ? calendar.getEvents(input)       : noGoogle();
    case 'create_calendar_event': return g ? calendar.createEvent(input)     : noGoogle();
    case 'delete_calendar_event': return g ? calendar.deleteEvent(input)     : noGoogle();
    // Memory
    case 'remember_fact':         return memory.rememberFact(input);
    case 'recall_facts':          return memory.recallFacts(input);
    case 'forget_fact':           return memory.forgetFact(input);
    // Files
    case 'search_files':          return files.searchFiles(input);
    case 'open_file':             await shell.openPath(input.path); return { opened: input.path };
    // Sys info
    case 'get_system_info':       return sysInfo.getSystemInfo();
    case 'get_clipboard':         return { content: clipboard.readText() };
    case 'set_clipboard':         clipboard.writeText(input.text); return { done: true };
    case 'send_notification': {
      const title = input.title || 'JARVIS';
      new Notification({ title, body: input.body }).show();
      notifs.record(title, input.body);
      return { sent: true };
    }
    // ── OS Control ────────────────────────────────────────────────────────
    case 'open_app':              return osCtrl.openApp(input);
    case 'close_app':             return osCtrl.closeApp(input);
    case 'list_running_apps':     return osCtrl.listRunningApps();
    case 'switch_to_app':         return osCtrl.switchToApp(input);
    case 'open_url':              return osCtrl.openUrl(input);
    case 'google_search':         return osCtrl.googleSearch(input);
    case 'send_whatsapp':         return osCtrl.sendWhatsApp(input);
    case 'facetime_call':         return osCtrl.facetimeCall(input);
    case 'set_volume':            return osCtrl.setVolume(input);
    case 'set_brightness':        return osCtrl.setBrightness(input);
    case 'take_screenshot': {
      mainWindow.hide();
      await new Promise(r => setTimeout(r, 500));
      const shot = await osCtrl.takeScreenshot(input);
      mainWindow.show();
      return shot;
    }
    case 'lock_screen':           return osCtrl.lockScreen();
    case 'system_sleep':          return osCtrl.systemSleep();

    // ── Screen Awareness ──────────────────────────────────────────────────
    case 'analyze_screen': {
      mainWindow.hide();
      await new Promise(r => setTimeout(r, 500));
      const analysis = await screen_.analyzeScreen(input.question);
      mainWindow.show();
      return analysis;
    }

    // ── Clipboard Manager ─────────────────────────────────────────────────
    case 'get_clipboard_history': return { history: clipHist.getHistory(input.n || 10) };
    case 'translate_clipboard': {
      const text = clipboard.readText();
      if (!text) return { error: 'Zwischenablage ist leer.' };
      return { original: text, targetLanguage: input.targetLanguage, note: 'JARVIS übersetzt jetzt direkt im Chat — kein extra Tool-Call nötig.' };
    }
    case 'improve_clipboard': {
      const text = clipboard.readText();
      if (!text) return { error: 'Zwischenablage ist leer.' };
      return { original: text, instruction: input.instruction || 'verbessern', note: 'JARVIS verbessert den Text direkt im Chat.' };
    }

    // ── Focus Mode ────────────────────────────────────────────────────────
    case 'start_focus_mode':      return focus.startFocus(input);
    case 'end_focus_mode':        return focus.endFocus();
    case 'get_focus_status':      return focus.getStatus();

    // ── Smart Notifications ───────────────────────────────────────────────
    case 'get_notification_history': return notifs.getHistory(input);

    // ── iMessage ─────────────────────────────────────────────────────────
    case 'get_imessages':  return imessage.getMessages(input);
    case 'send_imessage':  return imessage.sendMessage(input);

    // ── iCloud Mail ───────────────────────────────────────────────────────────
    case 'read_icloud_mail':   return icloudMail.getEmails(input);
    case 'get_icloud_mail':    return icloudMail.getEmailContent(input);
    case 'send_icloud_mail':   return icloudMail.sendEmail(input);

    // ── Contacts ─────────────────────────────────────────────────────────
    case 'search_contacts': return contacts.searchContacts(input);

    // ── Apple Notes ──────────────────────────────────────────────────────
    case 'get_notes':   return notes.getNotes(input);
    case 'create_note': return notes.createNote(input);

    // ── Reminders ────────────────────────────────────────────────────────
    case 'get_reminders':     return reminders.getReminders(input);
    case 'create_reminder':   return reminders.createReminder(input);
    case 'complete_reminder': return reminders.completeReminder(input);

    // ── Photos ───────────────────────────────────────────────────────────
    case 'search_photos': return photos.searchPhotos(input);

    // ── Safari ───────────────────────────────────────────────────────────
    case 'get_safari_tabs':       return safari.getSafariTabs();
    case 'search_safari_history': return safari.searchSafariHistory(input);

    // ── Notion ───────────────────────────────────────────────────────────
    case 'notion_search':      return notion.searchNotion(input);
    case 'notion_create_page': return notion.createPage(input);

    // ── Obsidian ─────────────────────────────────────────────────────────
    case 'obsidian_search':      return obsidian.searchNotes(input);
    case 'obsidian_get_note':    return obsidian.getNote(input);
    case 'obsidian_create_note': return obsidian.createNote(input);

    // ── Weather ──────────────────────────────────────────────────────────
    case 'get_weather': return weather.getWeather(input);

    // ── Web Search ───────────────────────────────────────────────────────
    case 'web_search': return search.webSearch(input);

    // ── News ─────────────────────────────────────────────────────────────
    case 'get_news': return newsService.getNews(input);

    // ── Stocks ───────────────────────────────────────────────────────────
    case 'get_stock': return stocks.getStock(input);

    // ── Crypto ───────────────────────────────────────────────────────────
    case 'get_crypto_price': return crypto.getCryptoPrice(input);
    case 'get_top_crypto':   return crypto.getTopCrypto(input);

    // ── Wikipedia ────────────────────────────────────────────────────────
    case 'wikipedia_search':  return wikipedia.searchWikipedia(input);
    case 'wikipedia_summary': return wikipedia.getWikipediaSummary(input);

    case 'system_restart': {
      await requestConfirmation('Mac neu starten?', 'Alle ungespeicherten Daten gehen verloren.');
      return osCtrl.systemRestart();
    }
    case 'system_shutdown': {
      const mins = input.minutes || 0;
      await requestConfirmation(
        `Mac ${mins ? `in ${mins} Minuten` : 'jetzt'} herunterfahren?`,
        'Alle ungespeicherten Daten gehen verloren.'
      );
      return osCtrl.systemShutdown(input);
    }
    case 'execute_shell': {
      const risk = osCtrl.classifyCommand(input.command);
      if (risk === 'dangerous' || risk === 'unknown') {
        await requestConfirmation(
          risk === 'dangerous' ? '⚠️ Gefährlicher Befehl' : 'Shell-Befehl ausführen?',
          input.command
        );
      }
      return osCtrl.executeShell(input);
    }

    default: return { error: `Unbekanntes Tool: ${name}` };
  }
}

function noGoogle() { return { error: 'Google nicht verbunden. Bitte in den Einstellungen verbinden.' }; }

// ── IPC: Chat ──────────────────────────────────────────────────────────────

ipcMain.on('close-window', () => mainWindow?.hide());

ipcMain.on('send-message', async (_e, userMsg) => {
  const gate = license.checkAndIncrement();
  if (!gate.allowed) {
    mainWindow.webContents.send('jarvis-paywall', gate.status);
    return;
  }
  try {
    const fullText = await claude.streamChat(history, userMsg, {
      onChunk:      (c) => mainWindow.webContents.send('jarvis-chunk', c),
      onToolStatus: (s) => mainWindow.webContents.send('jarvis-tool-status', s),
      onToolUse:    toolExecutor,
    });
    memory.saveHistory(history);
    mainWindow.webContents.send('jarvis-done', { fullText });
  } catch (err) {
    console.error('[Claude]', err.message);
    mainWindow.webContents.send('jarvis-error', err.message);
  }
});

// ── IPC: Shell ────────────────────────────────────────────────────────────
ipcMain.handle('open-external', (_e, url) => { shell.openExternal(url); return { ok: true }; });

// ── IPC: License ──────────────────────────────────────────────────────────
ipcMain.handle('license-status',   ()          => license.getStatus());
ipcMain.handle('license-activate', (_e, key)   => license.activateLicense(key));
ipcMain.handle('license-checkout', (_e, plan, yearly = false) => license.createCheckoutUrl(plan, yearly));
ipcMain.handle('license-revoke',   ()          => { license.revokeLicense(); return { done: true }; });

// ── IPC: Google ────────────────────────────────────────────────────────────
ipcMain.handle('google-status',  () => ({ configured: gmail.isConfigured(), authenticated: gmail.isAuthenticated() }));
ipcMain.handle('google-connect', async () => { try { await gmail.getAuth(); return { success:true }; } catch(e) { return { success:false, error:e.message }; } });
ipcMain.handle('google-revoke',  () => { gmail.revokeAuth(); return { success:true }; });

// ── IPC: Memory ────────────────────────────────────────────────────────────
ipcMain.handle('memory-stats',  () => memory.getStats());
ipcMain.handle('memory-clear',  () => { memory.clearMemory(); return { done:true }; });
ipcMain.handle('history-clear', () => { memory.clearHistory(); history.length = 0; return { done:true }; });

// ── IPC: Wake Word ─────────────────────────────────────────────────────────

// Wake-word focus gate. The flag is set true the first time a wake-word
// detection brings JARVIS to the foreground, and stays true until the user
// explicitly moves away (mainWindow 'blur'). While set, further detections
// only fire the renderer IPC — they do not yank macOS focus. This stops
// rapid-fire OWW detections from continuously stealing focus from whatever
// app the user has moved to.
let _wasActivatedByWakeWord = false;

// Track last wake-word focus steal so we don't yank focus on every detection.
let _lastWakeFocusAt = 0;

function safeSend(channel, ...args) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  // Defer to the next tick. Some Electron 28 builds throw
  // "Render frame was disposed" if send is called synchronously from
  // certain async contexts (subprocess stdout handlers, etc.).
  setImmediate(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const wc = mainWindow.webContents;
    if (!wc || wc.isDestroyed()) return;
    try {
      wc.send(channel, ...args);
    } catch (e) {
      console.warn('[safeSend] threw for', channel, ':', e.message);
    }
  });
  return true;
}

function wakeWordCallback() {
  console.log('[WakeFlow] wakeWordCallback fired — currentMode =', _windowMode, ', visible =', mainWindow?.isVisible());

  // Always update mode + notify renderer. setWindowMode is idempotent.
  const r = setWindowMode('hud');
  console.log('[WakeFlow] setWindowMode result:', r);

  // Notify renderer of detection (used for flash + safety-net mode switch)
  safeSend('wake-word-detected');
  safeSend('hud:open');

  // Only steal focus at most once per 4 seconds so rapid OWW hits don't
  // continuously yank the user away from whatever they're doing.
  const now = Date.now();
  if (now - _lastWakeFocusAt > 4000) {
    _lastWakeFocusAt = now;
    showWindow();
    console.log('[WakeFlow] showWindow done, isVisible =', mainWindow?.isVisible());
  } else {
    console.log('[WakeFlow] focus-steal rate-limited (last steal', now - _lastWakeFocusAt, 'ms ago)');
  }
}

ipcMain.handle('wake-word-start', () => {
  const key = configSvc.get('PICOVOICE_ACCESS_KEY') || process.env.PICOVOICE_ACCESS_KEY;
  // Persist the preference so we pre-warm on next boot
  configSvc.set('WAKE_WORD_ENABLED', 'true');
  return wakeWord.init(key, wakeWordCallback);
});

ipcMain.handle('wake-word-stop',   () => {
  configSvc.set('WAKE_WORD_ENABLED', '');
  wakeWord.stop();
  return { ok: true };
});
ipcMain.handle('wake-word-status', () => ({ active: wakeWord.isActive(), frameLength: wakeWord.frameLength(), sampleRate: wakeWord.sampleRate() }));

// Audio frames arrive as plain arrays from the renderer (IPC serialises Int16Array → Array)
ipcMain.on('wake-word-frame', (_e, samples) => wakeWord.processFrame(samples));

// ── IPC: Auto-Updater ─────────────────────────────────────────────────────
ipcMain.handle('update-install', () => { updater.installNow(); return { ok: true }; });

// ── IPC: Config status ─────────────────────────────────────────────────────
ipcMain.handle('config-status', () => ({
  anthropic:   !!process.env.ANTHROPIC_API_KEY,
  openai:      !!process.env.OPENAI_API_KEY,
  elevenlabs:  !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID),
  google:      gmail.isConfigured(),
  notion:      notion.isConfigured(),
  obsidian:    obsidian.isConfigured(),
  icloudMail:  icloudMail.isConfigured(),
  icloudEmail: !!process.env.ICLOUD_EMAIL,
  icloudPass:  !!process.env.ICLOUD_APP_PASSWORD,
}));

// ── IPC: Briefing toggle ───────────────────────────────────────────────────
ipcMain.handle('briefing-get', () => proactive.isBriefingEnabled());
ipcMain.handle('briefing-set', (_e, val) => { proactive.setBriefingEnabled(val); return { ok: true }; });

// ── IPC: Supabase config ───────────────────────────────────────────────────
ipcMain.handle('supabase-config', () => ({
  url: process.env.SUPABASE_URL || '',
  key: process.env.SUPABASE_ANON_KEY || '',
}));

// ── IPC: Window mode ───────────────────────────────────────────────────────
ipcMain.handle('set-window-mode', (_e, mode) => setWindowMode(mode));
ipcMain.handle('get-window-mode', () => _windowMode);

// ── IPC: HUD state + Map ──────────────────────────────────────────────────
// Renderer drives HUD state changes (voice loop already has the truth).
// These pass-throughs let any other module trigger HUD UI changes via IPC.
ipcMain.on('hud:state', (_e, state) => {
  mainWindow?.webContents.send('hud:state', state);
});
ipcMain.on('hud:open', () => {
  setWindowMode('hud');
  showWindow();
  mainWindow?.webContents.send('hud:open');
});
ipcMain.on('hud:close', () => {
  mainWindow?.webContents.send('hud:close');
  // Renderer triggers shutdown anim, then sends 'close-window' when done.
});
ipcMain.on('map:open', (_e, payload) => {
  setWindowMode('map');
  mainWindow?.webContents.send('map:open', payload);
});
ipcMain.on('map:close', () => {
  setWindowMode('hud');
  mainWindow?.webContents.send('map:close');
});

// ── IPC: Config get / set ──────────────────────────────────────────────────
ipcMain.handle('config-get', (_e, key) => configSvc.get(key));
ipcMain.handle('config-set', (_e, key, value) => {
  configSvc.set(key, value);
  // Re-init claude client so new key takes effect immediately
  if (key === 'ANTHROPIC_API_KEY') {
    try { claude.reinit(); } catch {}
  }
  return { ok: true };
});

// ── IPC: Permissions (onboarding) ─────────────────────────────────────────
ipcMain.handle('perm-check',              ()         => perms.getAllStatuses());
ipcMain.handle('perm-request-mic',        ()         => perms.requestMicrophone());
ipcMain.handle('perm-request-camera',     ()         => perms.requestCamera());
ipcMain.handle('perm-request-contacts',   ()         => perms.requestContacts());
ipcMain.handle('perm-request-calendar',   ()         => perms.requestCalendar());
ipcMain.handle('perm-request-reminders',  ()         => perms.requestReminders());
ipcMain.handle('perm-open-settings',      (_e, type) => { perms.openSettings(type); return { opened: type }; });
ipcMain.handle('perm-complete',         ()         => {
  perms.markSetupComplete();
  onboardingWindow?.close();
  onboardingWindow = null;
  if (app.dock) app.dock.hide();
  showWindow();
  return { done: true };
});

// ── IPC: STT / TTS ────────────────────────────────────────────────────────
ipcMain.handle('transcribe-audio', async (_e, buf, mime) => voice.transcribeAudio(Buffer.from(buf), mime||'audio/webm'));
ipcMain.handle('speak', async (_e, text) => {
  try { const b = await voice.textToSpeech(text); return b ? b.toString('base64') : null; }
  catch(e) { console.error('[TTS]', e.message); return null; }
});

// ── App lifecycle ──────────────────────────────────────────────────────────

// PNG is more reliable than .icns for app.dock.setIcon() in dev mode
const DOCK_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const ICNS_PATH      = path.join(__dirname, 'assets', 'jarvis.icns');

function setDockIcon() {
  if (!app.dock) return;
  const p = fs.existsSync(DOCK_ICON_PATH) ? DOCK_ICON_PATH : ICNS_PATH;
  if (fs.existsSync(p)) {
    app.dock.setIcon(nativeImage.createFromPath(p));
  }
}

function createOnboardingWindow() {
  onboardingWindow = new BrowserWindow({
    width: 560, height: 680,
    center: true, resizable: false,
    frame: false, transparent: false,
    titleBarStyle: 'hidden',
    vibrancy: 'under-window',
    webPreferences: {
      preload: path.join(__dirname, 'onboarding', 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  // Set icon and show dock BEFORE loading the page so icon is visible immediately
  setDockIcon();
  if (app.dock) app.dock.show();
  onboardingWindow.loadFile(path.join(__dirname, 'onboarding', 'index.html'));
  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
    if (!isDev) app.dock?.hide();
  });
}

app.whenReady().then(() => {
  // Load persisted API keys into process.env (must run after app is ready)
  configSvc.applyToEnv();

  // Local-only WebSocket bridge so the daylens.dev/brain browser app can
  // proxy Mac-level actions (open_app, shell, screenshot, clipboard) into
  // this Electron process. Loopback bind only.
  try { wsbridge.start(); } catch (e) { console.error('[main] wsbridge boot failed:', e?.message); }

  // Auto-open the brain web app 2 s after launch so it can find the bridge
  // already listening on 127.0.0.1:7777 by the time the page-load runs the
  // WS handshake. Skipped in dev mode (npm run dev) so iterating doesn't
  // spawn a new browser tab on every hot-reload.
  if (!isDev) {
    setTimeout(() => {
      shell.openExternal('https://daylens.dev/brain').catch((e) =>
        console.warn('[main] auto-open daylens.dev/brain failed:', e?.message)
      );
    }, 2000);
  }

  createWindow();
  createTray();
  globalShortcut.register('CommandOrControl+Shift+J', toggleWindow);

  if (perms.isFirstLaunch()) {
    // First launch: show onboarding with dock visible
    createOnboardingWindow();
  } else if (isDev) {
    // Dev mode: keep dock visible so icon is testable
    setDockIcon();
    if (app.dock) app.dock.show();
  } else {
    // Show dock icon for the large window
    setDockIcon();
    if (app.dock) app.dock.show();
  }

  // Proaktiver Modus — startet Cron-Jobs nach Window-Erstellung
  app.on('browser-window-created', () => {
    if (!proactive._initialized) {
      proactive._initialized = true;
      proactive.init({ mainWindow, gmail, calendar, notifyRecord: notifs.record });
    }
  });
  // Fallback: direkt initialisieren sobald Fenster existiert
  setTimeout(() => {
    if (mainWindow && !proactive._initialized) {
      proactive._initialized = true;
      proactive.init({ mainWindow, gmail, calendar, notifyRecord: notifs.record });
    }
    // Start auto-updater after app is fully ready
    updater.init(mainWindow);

    // Pre-warm wake word if it was enabled in the previous session — the OWW
    // subprocess takes ~10s to reach READY on a --onedir bundle. Doing it now
    // means the user doesn't sit on a "loading…" toggle later.
    if (configSvc.get('WAKE_WORD_ENABLED') === 'true') {
      const key = configSvc.get('PICOVOICE_ACCESS_KEY') || process.env.PICOVOICE_ACCESS_KEY;
      const r = wakeWord.init(key, wakeWordCallback);
      console.log('[WakeWord] pre-warm:', r);
    }
  }, 2000);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try { wsbridge.stop(); } catch {}
});

// In dev mode skip single-instance lock so `npm run dev` always works
// even when a previous dev session left a ghost process behind.
if (!isDev) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) app.quit();
  else app.on('second-instance', () => { if (mainWindow) showWindow(); });
}
