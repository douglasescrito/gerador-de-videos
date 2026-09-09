/**
 * Studio Layer Editor — Mixer Clássico de Camadas & Controle de Áudio em dB
 */

// Estado da Aplicação
const state = {
  projects: [],
  currentProject: null,
  whisperWords: [],
  duration: 60.04,
  currentTime: 0,
  isPlaying: false,
  isLooping: true,
  tracks: {
    voice: {
      name: "Locução Principal",
      baseGain: 5.0, // dB
      muted: false,
      solo: false,
      keyframes: [
        { time: 0.0, db: 5.0 },
        { time: 59.36, db: 5.0 }
      ]
    },
    music: {
      name: "Trilha Sonora",
      baseGain: 8.0, // dB
      muted: false,
      solo: false,
      keyframes: [
        { time: 0.0, db: 4.0 },
        { time: 0.8, db: -4.0 }, // Ducking inicial
        { time: 59.0, db: -4.0 },
        { time: 60.04, db: 8.0 }  // Arremate final
      ]
    },
    sfx: {
      name: "Sound Design (SFX)",
      baseGain: -10.0, // dB
      muted: false,
      solo: false,
      keyframes: [
        { time: 0.0, db: -10.0 },
        { time: 60.04, db: -10.0 }
      ]
    }
  }
};

// Elementos DOM
const videoPlayer = document.getElementById("video-player");
const audioVoice = document.getElementById("audio-voice");
const audioMusic = document.getElementById("audio-music");
const projectSelect = document.getElementById("project-select");
const timelineScrubber = document.getElementById("timeline-scrubber");
const tcCurrent = document.getElementById("tc-current");
const tcTotal = document.getElementById("tc-total");
const btnPlay = document.getElementById("btn-play");
const btnStop = document.getElementById("btn-stop");
const btnPrev = document.getElementById("btn-prev");
const btnLoop = document.getElementById("btn-loop");
const btnRenderMaster = document.getElementById("btn-render-master");
const btnOpenFolder = document.getElementById("btn-open-folder");
const whisperBadge = document.getElementById("whisper-badge");
const currentWordLabel = document.getElementById("current-word-label");

// Web Audio API Engine
let audioCtx = null;
let gainNodes = { voice: null, music: null, sfx: null };
let audioSourcesConnected = false;

function initAudioEngine() {
  if (audioCtx && audioSourcesConnected) return;

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Cria GainNodes para cada canal
    gainNodes.voice = audioCtx.createGain();
    gainNodes.music = audioCtx.createGain();
    gainNodes.sfx = audioCtx.createGain();

    const srcVoice = audioCtx.createMediaElementSource(audioVoice);
    const srcMusic = audioCtx.createMediaElementSource(audioMusic);
    const srcVideo = audioCtx.createMediaElementSource(videoPlayer);

    srcVoice.connect(gainNodes.voice).connect(audioCtx.destination);
    srcMusic.connect(gainNodes.music).connect(audioCtx.destination);
    srcVideo.connect(gainNodes.sfx).connect(audioCtx.destination);

    audioSourcesConnected = true;
    console.log("🎛️ Web Audio Engine Conectada com Sucesso!");
  } catch (err) {
    console.warn("Web Audio Fallback:", err);
  }
}

// Inicia aplicação
async function init() {
  setupEvents();
  await fetchProjects();
  requestAnimationFrame(syncLoop);
}

async function fetchProjects() {
  try {
    const res = await fetch("/api/projects");
    const data = await res.json();
    state.projects = data.projects;
    state.whisperWords = data.whisperWords || [];

    projectSelect.innerHTML = "";
    state.projects.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.fullName}`;
      projectSelect.appendChild(opt);
    });

    if (state.projects.length > 0) {
      loadProject(state.projects[0].id);
    }
  } catch (err) {
    console.error("Erro ao carregar projetos:", err);
  }
}

function loadProject(id) {
  const p = state.projects.find(x => x.id === id);
  if (!p) return;
  state.currentProject = p;

  videoPlayer.src = p.videoRawRel || (p.scenes[0] ? p.scenes[0].relPath : "");
  for (const [element, source] of [[audioVoice, p.audioVoice], [audioMusic, p.audioMusic]]) {
    if (source) element.src = source;
    else { element.removeAttribute('src'); element.load(); }
  }
  state.whisperWords = p.whisperWords ?? state.whisperWords;

  renderKeyframeLists();
  seek(0);
}

function setupEvents() {
  btnPlay.addEventListener("click", () => togglePlay());
  btnStop.addEventListener("click", () => {
    pause();
    seek(0);
  });
  btnPrev.addEventListener("click", () => seek(0));
  btnLoop.addEventListener("click", () => {
    state.isLooping = !state.isLooping;
    btnLoop.classList.toggle("active", state.isLooping);
  });

  projectSelect.addEventListener("change", (e) => loadProject(e.target.value));

  timelineScrubber.addEventListener("input", (e) => {
    seek(parseFloat(e.target.value));
  });

  btnOpenFolder.addEventListener("click", async () => {
    if (!state.currentProject) return;
    await fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderRel: state.currentProject.folderRel })
    });
  });

  btnRenderMaster.addEventListener("click", renderMasterMp4);

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    }
  });
}

function togglePlay() {
  initAudioEngine();
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  if (state.isPlaying) {
    pause();
  } else {
    play();
  }
}

function play() {
  initAudioEngine();
  videoPlayer.play().catch(() => {});
  audioVoice.play().catch(() => {});
  audioMusic.play().catch(() => {});

  state.isPlaying = true;
  btnPlay.innerHTML = "⏸️ Pausar";
  btnPlay.style.background = "var(--accent-amber)";
}

function pause() {
  videoPlayer.pause();
  audioVoice.pause();
  audioMusic.pause();

  state.isPlaying = false;
  btnPlay.innerHTML = "▶️ Play";
  btnPlay.style.background = "var(--accent-cyan)";
}

function seek(time) {
  time = Math.max(0, Math.min(state.duration, time));
  state.currentTime = time;
  timelineScrubber.value = time;

  videoPlayer.currentTime = time;
  audioVoice.currentTime = time;
  audioMusic.currentTime = time;

  updateAudioVolumes();
}

// Interpolação de Volume por Keyframes
function getInterpolatedDb(trackKey, time) {
  const kfs = state.tracks[trackKey].keyframes;
  if (!kfs || kfs.length === 0) return 0;
  if (kfs.length === 1) return kfs[0].db;

  if (time <= kfs[0].time) return kfs[0].db;
  if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].db;

  for (let i = 0; i < kfs.length - 1; i++) {
    const p0 = kfs[i];
    const p1 = kfs[i + 1];
    if (time >= p0.time && time <= p1.time) {
      const progress = (time - p0.time) / (p1.time - p0.time);
      return p0.db + progress * (p1.db - p0.db);
    }
  }
  return 0;
}

// Aplicação Imediata de Volume em Tempo Real
function updateAudioVolumes() {
  const hasSolo = Object.values(state.tracks).some(t => t.solo);

  ["voice", "music", "sfx"].forEach(key => {
    const track = state.tracks[key];
    const autoDb = getInterpolatedDb(key, state.currentTime);
    const totalDb = track.baseGain + (autoDb - (key === "voice" ? 5 : key === "music" ? 8 : -10));

    // Display
    const readoutEl = document.getElementById(`${key}-db-readout`);
    if (readoutEl) {
      readoutEl.textContent = `${totalDb > 0 ? "+" : ""}${totalDb.toFixed(1)} dB`;
    }

    let isSilent = track.muted || (hasSolo && !track.solo);

    // 1. Aplica via Web Audio GainNode (permite ganho > 1.0 / +15dB)
    if (audioCtx && gainNodes[key]) {
      if (isSilent) {
        gainNodes[key].gain.setValueAtTime(0, audioCtx.currentTime);
      } else {
        const linearGain = Math.pow(10, totalDb / 20);
        gainNodes[key].gain.setValueAtTime(Math.max(0, linearGain), audioCtx.currentTime);
      }
    }

    // 2. Aplica via HTML5 volume nativo (fallback de segurança)
    const el = key === "voice" ? audioVoice : key === "music" ? audioMusic : videoPlayer;
    if (el) {
      if (isSilent) {
        el.volume = 0;
      } else {
        // Mapeia dB para escala linear 0.0 - 1.0
        const lin = Math.pow(10, Math.min(0, totalDb) / 20);
        el.volume = Math.max(0, Math.min(1, lin));
      }
    }
  });
}

// Loop Principal de Sincronização
function syncLoop() {
  if (state.isPlaying) {
    state.currentTime = videoPlayer.currentTime;
    timelineScrubber.value = state.currentTime;

    if (state.currentTime >= state.duration) {
      if (state.isLooping) {
        seek(0);
        play();
      } else {
        pause();
        seek(0);
      }
    }
  }

  // Timecode
  const mins = Math.floor(state.currentTime / 60);
  const secs = (state.currentTime % 60).toFixed(1).padStart(4, "0");
  tcCurrent.textContent = `0${mins}:${secs}`;
  tcTotal.textContent = `01:00.0`;

  // Whisper HUD
  const activeWord = state.whisperWords.find(w => state.currentTime >= w.start - 0.1 && state.currentTime <= w.end + 0.2);
  if (activeWord) {
    whisperBadge.textContent = activeWord.text;
    currentWordLabel.innerHTML = `Palavra Atual: <strong>${activeWord.text}</strong> (${activeWord.start.toFixed(1)}s)`;
  }

  // Atualiza Volumes Contínuos
  updateAudioVolumes();

  requestAnimationFrame(syncLoop);
}

// Manipulação de Keyframes
window.addKeyframe = function(trackKey) {
  const curTime = parseFloat(state.currentTime.toFixed(1));
  const curDb = parseFloat(getInterpolatedDb(trackKey, curTime).toFixed(1));

  state.tracks[trackKey].keyframes.push({ time: curTime, db: curDb });
  state.tracks[trackKey].keyframes.sort((a, b) => a.time - b.time);

  renderKeyframeLists();
  updateAudioVolumes();
};

window.removeKeyframe = function(trackKey, index) {
  if (state.tracks[trackKey].keyframes.length <= 1) return;
  state.tracks[trackKey].keyframes.splice(index, 1);
  renderKeyframeLists();
  updateAudioVolumes();
};

window.setKeyframeDb = function(trackKey, index, val) {
  state.tracks[trackKey].keyframes[index].db = parseFloat(val);
  document.getElementById(`kf-val-${trackKey}-${index}`).textContent = `${val > 0 ? "+" : ""}${parseFloat(val).toFixed(1)} dB`;
  updateAudioVolumes();
};

window.setBaseGain = function(trackKey, val) {
  state.tracks[trackKey].baseGain = parseFloat(val);
  updateAudioVolumes();
};

window.toggleMute = function(trackKey) {
  state.tracks[trackKey].muted = !state.tracks[trackKey].muted;
  document.getElementById(`mute-${trackKey}`).classList.toggle("active-mute", state.tracks[trackKey].muted);
  updateAudioVolumes();
};

window.toggleSolo = function(trackKey) {
  state.tracks[trackKey].solo = !state.tracks[trackKey].solo;
  document.getElementById(`solo-${trackKey}`).classList.toggle("active-solo", state.tracks[trackKey].solo);
  updateAudioVolumes();
};

// Renderiza a lista de keyframes
function renderKeyframeLists() {
  ["voice", "music", "sfx"].forEach(trackKey => {
    const listEl = document.getElementById(`kf-list-${trackKey}`);
    listEl.innerHTML = "";

    state.tracks[trackKey].keyframes.forEach((kf, idx) => {
      const row = document.createElement("div");
      row.className = "kf-item-row";
      row.innerHTML = `
        <span class="kf-time-badge">${kf.time.toFixed(1)}s</span>
        <div class="kf-slider-inline">
          <input type="range" min="-30" max="15" step="0.5" value="${kf.db}" oninput="setKeyframeDb('${trackKey}', ${idx}, this.value)">
          <span class="kf-db-badge" id="kf-val-${trackKey}-${idx}">${kf.db > 0 ? "+" : ""}${kf.db.toFixed(1)} dB</span>
        </div>
        <button class="btn-del-kf" title="Remover Ponto" onclick="removeKeyframe('${trackKey}', ${idx})">❌</button>
      `;
      listEl.appendChild(row);
    });
  });
}

// Detecção e Nivelamento Automático de Picos da Trilha
window.autoDetectAndLevelMusicSurges = async function() {
  try {
    if (!state.currentProject?.audioMusic) throw new Error("Selecione uma coleção com trilha própria.");
    const res = await fetch("/api/detect-surges?projectId=" + encodeURIComponent(state.currentProject.id));
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    state.tracks.music.keyframes = data.compensationKeyframes;
    state.tracks.music.baseGain = 6.0;
    document.getElementById("slider-gain-music").value = 6.0;

    renderKeyframeLists();
    updateAudioVolumes();

    alert(`🎯 Análise Concluída!\n\nForam analisadas ${data.totalSamplesAnalyzed} amostras contínuas da trilha sonora.\n${data.surgePointsDetected} picos/crescendos foram detectados e atenuados automaticamente para dar clareza total à locução!`);
  } catch (err) {
    alert(`Erro na análise de picos: ${err.message}`);
  }
};

// Presets de Mixagem
window.applyMixPreset = function(type) {
  if (type === "natural") {
    state.tracks.voice.baseGain = 6.0;
    state.tracks.music.baseGain = 8.0;
    state.tracks.sfx.baseGain = -10.0;
    state.tracks.music.keyframes = [
      { time: 0.0, db: 4.0 },
      { time: 0.8, db: -4.0 },
      { time: 59.0, db: -4.0 },
      { time: 60.04, db: 8.0 }
    ];
  } else if (type === "voz-destaque") {
    state.tracks.voice.baseGain = 8.0;
    state.tracks.music.baseGain = 4.0;
    state.tracks.sfx.baseGain = -12.0;
  } else if (type === "musica-alta") {
    state.tracks.voice.baseGain = 5.0;
    state.tracks.music.baseGain = 10.0;
    state.tracks.sfx.baseGain = -8.0;
  } else if (type === "reset") {
    state.tracks.voice.baseGain = 5.0;
    state.tracks.music.baseGain = 8.0;
    state.tracks.sfx.baseGain = -10.0;
    state.tracks.voice.keyframes = [{ time: 0.0, db: 5.0 }, { time: 60.04, db: 5.0 }];
    state.tracks.music.keyframes = [{ time: 0.0, db: 8.0 }, { time: 60.04, db: 8.0 }];
    state.tracks.sfx.keyframes = [{ time: 0.0, db: -10.0 }, { time: 60.04, db: -10.0 }];
  }

  document.getElementById("slider-gain-voice").value = state.tracks.voice.baseGain;
  document.getElementById("slider-gain-music").value = state.tracks.music.baseGain;
  document.getElementById("slider-gain-sfx").value = state.tracks.sfx.baseGain;

  renderKeyframeLists();
  updateAudioVolumes();
};

// Export Master MP4 com FFmpeg
async function renderMasterMp4() {
  if (!state.currentProject) return;

  btnRenderMaster.disabled = true;
  btnRenderMaster.textContent = "⏳ Renderizando...";

  try {
    const payload = {
      projectId: state.currentProject.id,
      videoRawRel: state.currentProject.videoRawRel,
      voiceKeyframes: state.tracks.voice.keyframes.map(k => ({ time: k.time, db: k.db + (state.tracks.voice.baseGain - 5) })),
      musicKeyframes: state.tracks.music.keyframes.map(k => ({ time: k.time, db: k.db + (state.tracks.music.baseGain - 8) })),
      sfxKeyframes: state.tracks.sfx.keyframes.map(k => ({ time: k.time, db: k.db + (state.tracks.sfx.baseGain - (-10)) })),
      outName: `master-${state.currentProject.id}-mix-${Date.now()}`
    };

    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.ok) {
      alert(`🎉 Vídeo Master Exportado com Sucesso!\n\nSalvo em: ${data.outputFile}\nTamanho: ${data.sizeFormatted}`);
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    alert(`Erro ao renderizar: ${err.message}`);
  } finally {
    btnRenderMaster.disabled = false;
    btnRenderMaster.textContent = "🚀 Exportar Master MP4";
  }
}

// Inicia
init();
