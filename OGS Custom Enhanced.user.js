// ==UserScript==
// @name         OGS Custom Enhanced
// @namespace    http://tampermonkey.net/
// @version      2025-06-20
// @description  Removes clutter (NavBar, sidebars), adds custom background, home dock button, and enables scroll-to-navigate on OGS game/review/demo pages.
// @author       SoumyaK4 + kvwu
// @match        https://online-go.com/game/*
// @match        https://online-go.com/review/*
// @match        https://online-go.com/demo/*
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const waitFor = (selector) => new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  const cleanLayout = () => {
    const toRemove = ['.NavBar', '.AccessibilityMenu', '.Announcements', '.left-col'];
    toRemove.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.remove();
    });
    const actionBar = document.querySelector('.action-bar');
    if (actionBar) actionBar.style.display = 'none';

    const gameBoard = document.querySelector('div.Game.MainGobanView.wide');
    if (gameBoard) gameBoard.style.top = '0';
  };

  const addHomeDockButton = async () => {
    const dock = await waitFor('div.Dock');
    if (!dock.querySelector('.home-dock-button')) {
      const home = document.createElement('div');
      home.className = 'TooltipContainer home-dock-button';
      home.innerHTML = `
        <div class="Tooltip disabled"><p class="title">Back to OGS Home</p></div>
        <div><a href="/" style="text-decoration:none;color:inherit;font-weight:bold;"><i class="fa fa-home"></i> Home</a></div>`;
      dock.appendChild(home);
    }
  };

  const removeDockItems = async () => {
    const dock = await waitFor('div.Dock');
    const items = dock.querySelectorAll('div.TooltipContainer');
    [5, 8, 10, 11].forEach(i => items[i]?.remove());
  };

  const enableScrollNavigation = async () => {
    const goban = await waitFor('.goban-container');
    goban.onwheel = (e) => {
      e.preventDefault();
      const controls = document.querySelector('.action-bar .controls')?.children;
      if (!controls) return;
      (e.deltaY > 0 ? controls[4] : controls[2])?.click();
    };
  };

  const injectCSS = () => {
    const css = `
      .action-bar, .NavBar, header, .SiteHeader, .TopBar, .NavigationBar {
        display: none !important; height: 0 !important; padding: 0 !important; margin: 0 !important;
      }
      div.Game.MainGobanView.wide { top: 0 !important; }
      html, body { min-height: 100%; margin: 0; }
      html, #default-variant-container {
        background-image: url('https://raw.githubusercontent.com/JaKooLit/Wallpaper-Bank/main/wallpapers/Sun-Setting-Horizon.png');
        background-size: cover; background-position: center; background-repeat: no-repeat;
        background-color: transparent !important;
      }
      #main-content { background-color: transparent !important; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  };

  const onPageLoad = async () => {
    cleanLayout();
    injectCSS();
    addHomeDockButton();
    removeDockItems();
    enableScrollNavigation();
  };

  const observeUrlChange = () => {
    let currentUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        onPageLoad();
      }
    }).observe(document, { childList: true, subtree: true });
  };

  window.addEventListener('load', onPageLoad);
  observeUrlChange();
})();
