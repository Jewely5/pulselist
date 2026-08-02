const state = {
  activeTab: "grid",
  navOpen: false
};

const selectors = {
  navToggle: document.querySelector("[data-nav-toggle]"),
  navMenu: document.querySelector("[data-nav-menu]"),
  tabs: [...document.querySelectorAll("[data-tab]")],
  panels: [...document.querySelectorAll("[data-panel]")]
};

function setActiveTab(tabName) {
  state.activeTab = tabName;

  selectors.tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  selectors.panels.forEach((panel) => {
    const isActive = panel.dataset.panel === tabName;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
}

function toggleNav() {
  state.navOpen = !state.navOpen;

  selectors.navMenu.classList.toggle("is-open", state.navOpen);
  selectors.navToggle.setAttribute("aria-expanded", String(state.navOpen));
}

function closeNav() {
  state.navOpen = false;
  selectors.navMenu.classList.remove("is-open");
  selectors.navToggle.setAttribute("aria-expanded", "false");
}

function bindTabs() {
  selectors.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setActiveTab(tab.dataset.tab);
    });
  });
}

function bindNav() {
  if (!selectors.navToggle || !selectors.navMenu) return;

  selectors.navToggle.addEventListener("click", toggleNav);

  selectors.navMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeNav);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) {
      closeNav();
    }
  });
}

function init() {
  bindTabs();
  bindNav();
  setActiveTab(state.activeTab);
}

document.addEventListener("DOMContentLoaded", init);