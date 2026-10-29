const gameDetails = {
  chess: { title: "Chess", timer: "Count-up clock", players: ["2 players"], note: "Move clock and scoring rules follow Chess settings.", short: "CH" },
  carrom: { title: "Carrom", timer: "20 sec shot clock", players: ["2 players", "4 players"], note: "Queen cover shot and ICF scoring rules are enabled.", short: "CA" },
  ludo: { title: "Ludo", timer: "15 sec shot clock", players: ["2 players", "3 players", "4 players"], note: "Turn timer and safe-zone rules follow Ludo settings.", short: "LU" },
  snakes: { title: "Snakes & Ladders", timer: "10 sec auto-roll", players: ["2 players", "3 players", "4 players"], note: "Timed turns roll automatically. Movement scoring is enabled.", short: "SL" },
  business: { title: "Business Board", timer: "30 sec turns / 15 sec auctions", players: ["2 players", "3 players", "4 players", "5 players", "6 players"], note: "Auction clock and local property ledger are enabled.", short: "BB" },
  cue: { title: "Cue Sports", timer: "30 sec shot clock", players: ["2 players"], note: "Cue ruleset and shot-clock settings are enabled.", short: "CU" },
};

const legacyStorageKey = "sixfold-saved-setups";
const migrationStorageKey = "sixfold-sqlite-migrated-v1";
const gameCards = [...document.querySelectorAll(".game-card")];
const filterButtons = [...document.querySelectorAll(".filter-button")];
const setupDialog = document.querySelector("#setupDialog");
const setupForm = document.querySelector("#setupForm");
const playerSelect = document.querySelector("#playerSelect");
const dialogTitle = document.querySelector("#dialogTitle");
const dialogSubtitle = document.querySelector("#dialogSubtitle");
const clockValue = document.querySelector("#clockValue");
const modeDescription = document.querySelector("#modeDescription");
const setupNote = document.querySelector("#setupNote");
const cueRulesetField = document.querySelector("#cueRulesetField");
const toast = document.querySelector("#toast");

let activeFilter = "all";
let activeRoute = "play";
let activeGame = "chess";
let cueVariant = "pool";
let toastTimeout;

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

async function migrateLegacySetups() {
  if (localStorage.getItem(migrationStorageKey)) return;
  let legacySetups = [];
  try {
    const stored = JSON.parse(localStorage.getItem(legacyStorageKey) || "[]");
    if (Array.isArray(stored)) legacySetups = stored;
  } catch {
    legacySetups = [];
  }
  for (const setup of legacySetups) {
    if (!gameDetails[setup.game]) continue;
    await apiRequest("/api/matches", {
      method: "POST",
      body: JSON.stringify({
        gameId: setup.game,
        ruleset: setup.game === "cue" ? setup.variant || "pool" : null,
        mode: ["offline", "online", "lan"].includes(setup.mode) ? setup.mode : "offline",
        playerCount: Number.parseInt(setup.players, 10) || 2,
        status: "setup",
        snapshot: setup,
      }),
    });
  }
  localStorage.setItem(migrationStorageKey, "true");
}

function selectedMode() {
  return setupForm.querySelector('input[name="matchMode"]:checked')?.value || "offline";
}

function setMode(mode) {
  const input = setupForm.querySelector(`input[name="matchMode"][value="${mode}"]`);
  if (input) input.checked = true;
  updateModeDescription();
}

function selectedGameTitle(game = activeGame, variant = cueVariant) {
  if (game === "cue") return variant === "snooker" ? "Snooker" : "8-Ball Pool";
  return gameDetails[game].title;
}

function applyFilters() {
  const query = document.querySelector("#gameSearch").value.trim().toLowerCase();
  let visible = 0;
  gameCards.forEach((card) => {
    const matchesCategory = activeFilter === "all" || card.dataset.category === activeFilter;
    const matchesQuery = `${card.dataset.name} ${card.dataset.title} ${card.dataset.timer}`.toLowerCase().includes(query);
    const show = matchesCategory && matchesQuery;
    card.hidden = !show;
    if (show) visible += 1;
  });
  document.querySelector("#resultCount").textContent = String(visible).padStart(2, "0");
  document.querySelector("#emptyState").hidden = visible !== 0;
}

function setFilter(filter) {
  activeFilter = filter;
  filterButtons.forEach((button) => {
    const selected = button.dataset.filter === filter;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  applyFilters();
}

function setCueVariant(variant) {
  cueVariant = variant;
  document.querySelectorAll("[data-variant]").forEach((button) => {
    const selected = button.dataset.variant === variant;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-dialog-variant]").forEach((button) => {
    const selected = button.dataset.dialogVariant === variant;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelector(".cue-rule-label").textContent = variant === "snooker" ? "Reds & colors" : "Solids & stripes";
  if (activeGame === "cue") updateDialog();
}

function updateDialog() {
  const details = gameDetails[activeGame];
  const title = selectedGameTitle();
  dialogTitle.textContent = title;
  dialogSubtitle.textContent = `${title} match settings`;
  clockValue.textContent = details.timer;
  setupNote.textContent = details.note;
  cueRulesetField.hidden = activeGame !== "cue";
  playerSelect.replaceChildren(...details.players.map((player) => {
    const option = document.createElement("option");
    option.value = player;
    option.textContent = player;
    return option;
  }));
  document.querySelector("#setupIndex").textContent = String(Object.keys(gameDetails).indexOf(activeGame) + 1).padStart(2, "0");
}

function openSetup(game) {
  activeGame = game;
  updateDialog();
  setMode("offline");
  setupDialog.showModal();
}

function updateModeDescription() {
  modeDescription.textContent = selectedMode() === "online"
    ? "Online matches are server-authoritative. Local network lobbies use peer-to-peer sync."
    : "Play on this device. Your profile and setups stay local.";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

async function renderSavedSetups() {
  let matches;
  try {
    ({ matches } = await apiRequest("/api/matches?limit=100"));
  } catch (error) {
    showToast(`Could not load saved matches: ${error.message}`);
    return;
  }
  const list = document.querySelector("#savedList");
  list.replaceChildren();
  document.querySelector("#savedCount").textContent = String(matches.length).padStart(2, "0");
  document.querySelector("#savedTotal").textContent = `${matches.length} SAVED`;
  document.querySelector("#savedEmpty").hidden = matches.length > 0;
  matches.forEach((match) => {
    const item = document.createElement("article");
    item.className = "saved-item";
    const mark = document.createElement("span");
    mark.className = "saved-game-mark";
    mark.textContent = gameDetails[match.gameId]?.short || "GM";
    mark.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    copy.className = "saved-item-copy";
    const title = document.createElement("strong");
    title.textContent = match.ruleset === "snooker" ? "Snooker" : match.ruleset === "pool" ? "8-Ball Pool" : gameDetails[match.gameId]?.title || "Game";
    const details = document.createElement("span");
    const modeLabel = match.mode === "lan" ? "Local network" : match.mode === "online" ? "Online" : "Offline";
    details.textContent = `${modeLabel}  /  ${match.playerCount} players  /  ${match.status}`;
    copy.append(title, details);
    const actions = document.createElement("div");
    actions.className = "saved-actions";
    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.className = "saved-reopen";
    useButton.textContent = "Load setup";
    useButton.addEventListener("click", async () => {
      try {
        const { match: savedMatch } = await apiRequest(`/api/matches/${match.id}`);
        if (savedMatch.gameId === "cue") setCueVariant(savedMatch.ruleset || "pool");
        openSetup(savedMatch.gameId);
        setMode(savedMatch.mode);
        playerSelect.value = `${savedMatch.playerCount} players`;
      } catch (error) {
        showToast(`Could not load setup: ${error.message}`);
      }
    });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "saved-delete";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${title.textContent} saved match`);
    deleteButton.addEventListener("click", async () => {
      try {
        await apiRequest(`/api/matches/${match.id}`, { method: "DELETE" });
        await renderSavedSetups();
        showToast("Saved match deleted.");
      } catch (error) {
        showToast(`Could not delete match: ${error.message}`);
      }
    });
    actions.append(useButton, deleteButton);
    item.append(mark, copy, actions);
    list.append(item);
  });
}

function setRoute(route) {
  activeRoute = route;
  const isPlay = route === "play";
  document.querySelector("#playIntro").hidden = !isPlay;
  document.querySelector("#libraryView").hidden = !isPlay;
  document.querySelector("#savedView").hidden = isPlay;
  document.querySelector("#breadcrumbCurrent").textContent = isPlay ? "PLAY" : "SAVED SETUPS";
  document.querySelectorAll("[data-route]").forEach((button) => {
    const selected = button.dataset.route === route;
    button.classList.toggle("is-active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (!isPlay) void renderSavedSetups();
  document.querySelector("#sidebar").classList.remove("is-open");
  document.querySelector("#menuButton").setAttribute("aria-expanded", "false");
}

filterButtons.forEach((button) => button.addEventListener("click", () => setFilter(button.dataset.filter)));
document.querySelector("#gameSearch").addEventListener("input", applyFilters);
document.querySelector("#clearSearch").addEventListener("click", () => {
  document.querySelector("#gameSearch").value = "";
  setFilter("all");
});
document.querySelectorAll("[data-setup]").forEach((button) => button.addEventListener("click", () => openSetup(button.dataset.setup)));
document.querySelectorAll("[data-variant]").forEach((button) => button.addEventListener("click", () => setCueVariant(button.dataset.variant)));
document.querySelectorAll("[data-dialog-variant]").forEach((button) => button.addEventListener("click", () => setCueVariant(button.dataset.dialogVariant)));
setupForm.querySelectorAll('input[name="matchMode"]').forEach((input) => input.addEventListener("change", updateModeDescription));
document.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => setRoute(button.dataset.route)));
document.querySelector("#browseGames").addEventListener("click", () => setRoute("play"));
document.querySelector("#quickSetupButton").addEventListener("click", () => openSetup("chess"));
document.querySelector("#closeDialog").addEventListener("click", () => setupDialog.close());
document.querySelector("#cancelDialog").addEventListener("click", () => setupDialog.close());
document.querySelector("#menuButton").addEventListener("click", (event) => {
  const sidebar = document.querySelector("#sidebar");
  const open = sidebar.classList.toggle("is-open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});
setupDialog.addEventListener("click", (event) => {
  if (event.target === setupDialog) setupDialog.close();
});
setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = selectedMode();
  const setup = {
    gameId: activeGame,
    ruleset: activeGame === "cue" ? cueVariant : null,
    mode,
    playerCount: Number.parseInt(playerSelect.value, 10),
    status: "setup",
    snapshot: {
      title: selectedGameTitle(),
      timer: gameDetails[activeGame].timer,
      playerCount: Number.parseInt(playerSelect.value, 10),
      mode,
    },
  };
  try {
    await apiRequest("/api/matches", { method: "POST", body: JSON.stringify(setup) });
    setupDialog.close();
    await renderSavedSetups();
    showToast(`${selectedGameTitle()} setup saved to the SQLite ledger.`);
  } catch (error) {
    showToast(`Could not save setup: ${error.message}`);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !setupDialog.open && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    document.querySelector("#gameSearch").focus();
  }
  if (event.key === "Escape") document.querySelector("#sidebar").classList.remove("is-open");
});

async function initializeLedger() {
  try {
    const { profile } = await apiRequest("/api/profile");
    document.querySelector(".profile-copy strong").textContent = profile.displayName;
    await migrateLegacySetups();
    await renderSavedSetups();
  } catch (error) {
    showToast(`SQLite ledger unavailable: ${error.message}`);
  }
}

void initializeLedger();