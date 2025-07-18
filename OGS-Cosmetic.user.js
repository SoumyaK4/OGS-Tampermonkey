// ==UserScript==
// @name         OGS Custom Cosmetics
// @namespace    https://soumyak4.in
// @version      2.5
// @description  Clean UI, custom background (URL/upload/reset), scroll nav, dock buttons (incl. Toggle UI) on OGS game/review/demo pages. Now includes Shift/Ctrl+Scroll behavior.
// @author       SoumyaK4
// @match        https://online-go.com/game/*
// @match        https://online-go.com/review/*
// @match        https://online-go.com/demo/*
// @downloadURL  https://raw.githubusercontent.com/SoumyaK4/OGS-Tampermonkey/main/OGS-Cosmetic.user.js
// @updateURL    https://raw.githubusercontent.com/SoumyaK4/OGS-Tampermonkey/main/OGS-Cosmetic.user.js
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_BG = 'https://raw.githubusercontent.com/JaKooLit/Wallpaper-Bank/main/wallpapers/Sun-Setting-Horizon.png';

  const waitFor = (selector) => new Promise(resolve => {
    const found = document.querySelector(selector);
    if (found) return resolve(found);
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
    ['.NavBar', '.AccessibilityMenu', '.Announcements', '.left-col'].forEach(sel => {
      document.querySelector(sel)?.remove();
    });
    const actionBar = document.querySelector('.action-bar');
    if (actionBar) actionBar.style.display = 'none';
    document.querySelector('div.Game.MainGobanView.wide')?.style.setProperty('top', '0');
  };

  const injectCSS = () => {
    const css = `
      .action-bar, .NavBar, header, .SiteHeader, .TopBar, .NavigationBar {
        display: none !important; height: 0 !important; padding: 0 !important; margin: 0 !important;
      }
      div.Game.MainGobanView.wide { top: 0 !important; }
      html, body { min-height: 100%; margin: 0; }
      #main-content { background-color: transparent !important; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  };

  const setCustomBackground = () => {
    const url = localStorage.getItem('ogs-custom-bg') || DEFAULT_BG;
    document.documentElement.style.backgroundImage = `url('${url}')`;
    document.documentElement.style.backgroundSize = 'cover';
    document.documentElement.style.backgroundPosition = 'center';
    document.documentElement.style.backgroundRepeat = 'no-repeat';

    const container = document.getElementById('default-variant-container');
    if (container) {
      container.style.backgroundImage = `url('${url}')`;
      container.style.backgroundSize = 'cover';
      container.style.backgroundPosition = 'center';
      container.style.backgroundRepeat = 'no-repeat';
      container.style.backgroundColor = 'transparent';
    }
  };

  const backgroundOptionMenu = () => {
    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed; top: 100px; left: 50%; transform: translateX(-50%);
      background: #222; color: white; padding: 10px 20px;
      border-radius: 8px; z-index: 9999; font-family: sans-serif;
      box-shadow: 0 0 10px rgba(0,0,0,0.5); text-align: center;
    `;

    container.innerHTML = `
      <p style="margin: 10px 0; font-weight: bold;">Set Background</p>
      <button id="reset-bg" style="margin: 5px;">Reset to Default</button>
      <button id="url-bg" style="margin: 5px;">From Image URL</button>
      <button id="upload-bg" style="margin: 5px;">Upload from PC</button><br/>
      <button id="close-bg" style="margin-top: 10px;">Cancel</button>
    `;

    document.body.appendChild(container);

    document.getElementById('reset-bg').onclick = () => {
      localStorage.removeItem('ogs-custom-bg');
      setCustomBackground();
      container.remove();
    };

    document.getElementById('url-bg').onclick = () => {
      const url = prompt('Enter image URL:');
      if (url?.trim()) {
        localStorage.setItem('ogs-custom-bg', url.trim());
        setCustomBackground();
      }
      container.remove();
    };

    document.getElementById('upload-bg').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          localStorage.setItem('ogs-custom-bg', reader.result);
          setCustomBackground();
        };
        reader.readAsDataURL(file);
      };
      input.click();
      container.remove();
    };

    document.getElementById('close-bg').onclick = () => container.remove();
  };

  const addBackgroundSetterButton = async () => {
    const dock = await waitFor('div.Dock');
    if (dock.querySelector('.set-bg-button')) return;

    const bgButton = document.createElement('div');
    bgButton.className = 'TooltipContainer set-bg-button';
    bgButton.innerHTML = `
      <div class="Tooltip disabled"><p class="title">Set Custom Background</p></div>
      <div><a href="#" style="text-decoration:none;color:inherit;font-weight:bold;"><i class="fa fa-image"></i> Set Background</a></div>
    `;

    bgButton.addEventListener('click', backgroundOptionMenu);

    const homeBtn = dock.querySelector('.home-dock-button');
    if (homeBtn) {
      dock.insertBefore(bgButton, homeBtn);
    } else {
      dock.appendChild(bgButton);
    }
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

  const addToggleUIButton = async () => {
    const dock = await waitFor('div.Dock');
    if (dock.querySelector('.toggle-ui-button')) return;

    const toggleButton = document.createElement('div');
    toggleButton.className = 'TooltipContainer toggle-ui-button';
    toggleButton.innerHTML = `
      <div class="Tooltip disabled"><p class="title">Toggle Analyze Tools</p></div>
      <div><a href="#" style="text-decoration:none;color:inherit;font-weight:bold;"><i class="fa fa-eye-slash"></i> Toggle UI</a></div>
    `;

    toggleButton.addEventListener('click', () => {
      const playControls = document.querySelector('.PlayControls');
      if (playControls) {
        playControls.style.display = (playControls.style.display === 'none') ? '' : 'none';
      }

      ['.NavBar', '.AccessibilityMenu', '.Announcements', '.left-col', '.action-bar'].forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.style.display = (el.style.display === 'none') ? '' : 'none';
      });
    });

    const homeBtn = dock.querySelector('.home-dock-button');
    if (homeBtn) {
      dock.insertBefore(toggleButton, homeBtn);
    } else {
      dock.appendChild(toggleButton);
    }
  };

  const removeDockItems = async () => {
    const dock = await waitFor('div.Dock');
    const items = dock.querySelectorAll('div.TooltipContainer');
    [1, 5, 8, 10, 11].forEach(i => items[i]?.remove());
  };

  const enableScrollNavigation = async () => {
    const goban = await waitFor('.goban-container');
    goban.onwheel = (e) => {
      e.preventDefault();
      const controls = document.querySelector('.action-bar .controls')?.children;
      if (!controls) return;

      if (e.ctrlKey) {
        // Ctrl + Scroll
        (e.deltaY > 0 ? controls[6] : controls[0])?.click();
      } else if (e.shiftKey) {
        // Shift + Scroll
        (e.deltaY > 0 ? controls[5] : controls[1])?.click();
      } else {
        // Default Scroll
        (e.deltaY > 0 ? controls[4] : controls[2])?.click();
      }
    };
  };

  const onPageLoad = async () => {
    cleanLayout();
    injectCSS();
    setCustomBackground();
    addBackgroundSetterButton();
    addHomeDockButton();
    addToggleUIButton();
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
