// ==UserScript==
// @name         OGS Custom Cosmetics + UI/UX
// @namespace    https://soumyak4.in
// @version      4.0.4
// @description  Improve OGS game/review/demo layout, adds a logo navigation menu, custom backgrounds, scroll navigation, AI Sensei, and move timing.
// @author       SoumyaK4
// @match        https://online-go.com/game/*
// @match        https://online-go.com/review/*
// @match        https://online-go.com/demo/*
// @downloadURL  https://raw.githubusercontent.com/SoumyaK4/OGS-Tampermonkey/main/OGS-Cosmetic.user.js
// @updateURL    https://raw.githubusercontent.com/SoumyaK4/OGS-Tampermonkey/main/OGS-Cosmetic.user.js
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      kifubara.app
// ==/UserScript==

(function () {
    'use strict';

    // USER SWITCHES — change true to false (or back), save, then reload OGS.
    const FEATURES = {
        compactLayout: true,     // Compact desktop board/sidebar and status banner.
        logoNavigation: true,    // Replace the desktop navbar with the logo menu.
        goTVIndicator: true,     // Live stream count beside our logo (needs logoNavigation).
        customDock: true,        // Replace the desktop tab bar with the right Dock.
        customBackground: true,  // Saved background image and background picker.
        leftAIReview: true,      // AI review in the left column (needs compactLayout).
        compactAnalysis: true,   // Align analysis tools and shrink move comments.
        hideMoveControls: true,  // Hide desktop move buttons/slider (needs wheelNavigation).
        hideRematch: true,       // Hide the sidebar Rematch button.
        zenMode: true,           // Dock: toggle analysis tools.
        aiSensei: true,          // Dock: open this game in AI Sensei (game pages only).
        tsumegoDragon: true,     // Dock: open this game in Tsumego Dragon (game pages only).
        kifubara: true,          // Dock: import this game's SGF into Kifubara (game pages only).
        moveTiming: true,        // Dock: interactive move timing chart.
        wheelNavigation: true,   // Board wheel; Shift = 10 moves, Ctrl = first/last.
    };
    if (!Object.values(FEATURES).some(Boolean)) return;

    // Granted userscripts run in a sandbox; OGS controllers live on the page window.
    const ogsWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;

    /*
     * OGS is a single-page application, so most of its interface can change
     * without a full page reload. This script leaves OGS game logic in charge
     * and adds a presentation layer around the live OGS controls.
     */

    // User-facing defaults and external assets.
    const DEFAULT_BG = 'https://raw.githubusercontent.com/SoumyaK4/OGS-Tampermonkey/main/wall.png';
    const LOGO_URL = 'https://raw.githubusercontent.com/online-go/online-go.com/main/assets/ogs_bw.svg';
    const ACTIVE_CLASS = 'ogs-cosmetic-active';
    const STORAGE_KEYS = {
        backgroundMode: 'ogs-background-mode',
        customBackground: 'ogs-custom-bg',
    };

    // Route patterns are kept together so every feature agrees on page scope.
    const SUPPORTED_ROUTE = /^\/(game|review|demo)\//;
    const RECORD_ROUTE = /^\/(game|review)\/(\d+)/;
    const GAME_ROUTE = /^\/game\/(\d+)(?:\/|$)/;

    // This menu is shown immediately if OGS has not rendered its own navbar yet.
    const FALLBACK_NAVIGATION = [
        { label: 'Home', href: '/' },
        {
            label: 'Play',
            href: '/play',
            children: [
                { label: 'Play', href: '/play' },
                { label: 'Tournaments', href: '/tournaments' },
                { label: 'Ladders', href: '/ladders' },
            ],
        },
        {
            label: 'Learn',
            href: '/learn-to-play-go',
            children: [
                { label: 'Learn to play Go', href: '/learn-to-play-go' },
                { label: 'AI game reviews', href: '/supporter' },
                { label: 'Puzzles', href: '/puzzles' },
                { label: 'Other Go Resources', href: '/docs/other-go-resources' },
            ],
        },
        {
            label: 'Watch',
            href: '/observe-games',
            children: [
                { label: 'Games', href: '/observe-games' },
                { label: 'GoTV', href: '/gotv' },
            ],
        },
        {
            label: 'Community',
            href: '/chat',
            children: [
                { label: 'Forums', href: 'https://forums.online-go.com/', external: true },
                { label: 'Chat', href: '/chat' },
                { label: 'Groups', href: '/groups' },
                { label: "What's New", href: '/whats-new' },
                { label: 'Support OGS', href: '/supporter' },
                { label: 'About', href: '/docs/about' },
                { label: 'Documentation & FAQ', href: 'https://github.com/online-go/online-go.com/wiki', external: true },
            ],
        },
        {
            label: 'Tools',
            children: [
                { label: 'Joseki', href: '/joseki' },
                { label: 'SGF Library', href: '/library' },
                { label: 'Rating Calculator', href: '/rating-calculator' },
            ],
        },
        { label: 'Visual Settings', cosmeticAction: 'visual-settings', dropdown: true },
        {
            label: 'Account',
            children: [
                { label: 'Settings', href: '/user/settings' },
                { label: 'Sign in', href: '/sign-in' },
            ],
        },
    ];

    // Runtime state used to avoid rebuilding UI on every OGS DOM mutation.
    let navSignature = '';
    let dockSignature = '';
    let scheduled = false;
    let observedUrl = location.href;
    let boundGoban = null;
    let moveTimingTimer = null;
    let moveTimingRequest = 0;
    let visualSettingsOpening = false;
    let observedRecord = location.pathname.match(RECORD_ROUTE)?.[0];
    const originalCommentRows = new Map();
    const navActionSources = new Map();

    // Small shared helpers.
    const onSupportedPage = () => SUPPORTED_ROUTE.test(location.pathname);
    const textOf = (element) => (element?.textContent || '').replace(/\s+/g, ' ').trim();

    // All visual overrides live in one style element so reapplying is idempotent.
    const injectCSS = () => {
        if (document.getElementById('ogs-cosmetic-styles')) return;

        const style = document.createElement('style');
        style.id = 'ogs-cosmetic-styles';
        style.textContent = `
          /* Shared dimensions and restored three-column page layout. */
          html.${ACTIVE_CLASS} {
            --dock-width: 15rem !important;
            --ogs-cosmetic-sidebar-width: clamp(20rem, 25vw, 24rem);
          }

          html.${ACTIVE_CLASS}.ogs-custom-background body,
          html.${ACTIVE_CLASS}.ogs-custom-background #main-content,
          html.${ACTIVE_CLASS}.ogs-custom-background #default-variant-container {
            background: transparent !important;
          }

          html.${ACTIVE_CLASS}.ogs-logo-navigation .NavBar {
            display: none !important;
          }

          html.${ACTIVE_CLASS}.ogs-logo-navigation .GobanView.Game {
            top: 0 !important;
          }

          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game {
            column-gap: 0 !important;
            background: transparent !important;
            --goban-view-sidebar-gap: 4px;
          }

          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView-sidebar-resizer {
            display: none;
          }

          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .GobanView-center {
            flex: 1 1 auto !important;
            padding-left: 0 !important;
            min-width: 0;
            max-width: none !important;
            margin-right: 4px !important;
          }

          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .GobanView-center,
          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .goban-container {
            background: transparent !important;
          }

          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .GobanView-sidebar {
            width: var(--ogs-cosmetic-sidebar-width) !important;
            margin: 4px 4px 4px 0 !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }

          @media (min-width: 1100px) {
            html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .GobanView-center {
              margin-left: calc(var(--ogs-cosmetic-sidebar-width) + 8px) !important;
            }

            html.${ACTIVE_CLASS}.ogs-left-ai-review .GobanView.Game:not(.portrait) .AIReview:not(:empty) {
              position: fixed !important;
              top: 88px;
              bottom: 4px;
              left: 4px;
              z-index: 3;
              box-sizing: border-box;
              width: calc(var(--ogs-cosmetic-sidebar-width) - 8px);
              max-height: none;
              padding: 0.35rem;
              overflow-x: hidden;
              overflow-y: auto;
              background: transparent !important;
              border-radius: 0;
              box-shadow: none !important;
            }

            html.${ACTIVE_CLASS}.ogs-left-ai-review.ogs-move-timing-open .GobanView.Game:not(.portrait) .AIReview:not(:empty) {
              bottom: 4px;
            }

            html.${ACTIVE_CLASS}.ogs-left-ai-review .GobanView.Game:not(.portrait) .AIReview .ai-review-togglers {
              justify-content: center !important;
              align-items: center !important;
              gap: 0.65rem;
            }

            html.${ACTIVE_CLASS}.ogs-left-ai-review .GobanView.Game:not(.portrait) .AIReview .ai-review-togglers .left-section {
              display: none !important;
            }

            html.${ACTIVE_CLASS}.ogs-left-ai-review .GobanView.Game:not(.portrait) .AIReview .ai-review-togglers .middle-section,
            html.${ACTIVE_CLASS}.ogs-left-ai-review .GobanView.Game:not(.portrait) .AIReview .ai-review-togglers .right-section {
              flex: 0 0 auto !important;
            }

            html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .GobanView-sidebar > .GobanView-header.ogs-header-source {
              display: none !important;
            }

            html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .ogs-relocated-game-header {
              display: block;
              width: 100%;
              box-sizing: border-box;
              border-radius: 0;
            }

            html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .ogs-relocated-game-header:empty {
              display: none;
            }
          }

          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .GobanView-sidebar-content {
            padding: 0 !important;
            background: transparent !important;
          }

          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game .GobanView-header {
            box-sizing: border-box;
            min-height: 0 !important;
            padding: 0.14rem 0.45rem !important;
            font-size: 0.9rem !important;
            line-height: 1.1 !important;
          }

          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .GobanView-tab-panel.always,
          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .GameChat,
          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .chat-container,
          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .log-player-container,
          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .chat-log-container,
          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .chat-log,
          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .chat-log-spacer,
          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .chat-log-inner {
            background: transparent !important;
          }

          html.${ACTIVE_CLASS}.ogs-hide-move-controls .GobanView.Game .MoveNumberSlider,
          html.${ACTIVE_CLASS}.ogs-hide-move-controls .GobanView.Game .MoveNumberControl {
            display: none !important;
          }

          html.${ACTIVE_CLASS}.ogs-compact-analysis #game-move-node-text.ogs-cosmetic-move-comments {
            display: block;
            box-sizing: border-box;
            width: calc(100% + 1rem);
            margin-left: -0.5rem;
            resize: both !important;
          }

          html.${ACTIVE_CLASS}.ogs-custom-dock .PlayControls > .ogs-cosmetic-dock-safe {
            box-sizing: border-box;
            width: calc(100% - 3.2rem) !important;
          }

          html.${ACTIVE_CLASS}.ogs-compact-analysis .ogs-cosmetic-dock-safe > .game-analyze-button-bar {
            display: grid;
            grid-template-columns: repeat(6, minmax(0, 1fr));
            width: min(calc(100% - 1rem), 20rem);
            margin-right: auto;
            margin-left: auto;
          }

          html.${ACTIVE_CLASS}.ogs-compact-analysis .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group {
            display: flex;
            width: 100%;
          }

          html.${ACTIVE_CLASS}.ogs-compact-analysis .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(1),
          html.${ACTIVE_CLASS}.ogs-compact-analysis .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(4),
          html.${ACTIVE_CLASS}.ogs-compact-analysis .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(5) {
            grid-column: 1 / -1;
          }

          html.${ACTIVE_CLASS}.ogs-compact-analysis .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(2) {
            grid-column: 1 / span 3;
          }

          html.${ACTIVE_CLASS}.ogs-compact-analysis .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(3) {
            grid-column: 4 / span 3;
          }

          /* Game analysis adds an exit row that review/demo toolbars do not have. */
          html.${ACTIVE_CLASS}.ogs-compact-analysis .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .analyze-mode-buttons {
            grid-column: 1 / -1;
            justify-self: center;
          }

          html.${ACTIVE_CLASS}.ogs-compact-analysis .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .analyze-mode-buttons button {
            white-space: nowrap;
          }

          html.${ACTIVE_CLASS}.ogs-compact-analysis .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(-n + 5) > button,
          html.${ACTIVE_CLASS}.ogs-compact-analysis .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(-n + 5) > input {
            flex: 1 1 0;
            width: auto;
            min-width: 0;
          }

          html.${ACTIVE_CLASS}.ogs-custom-dock .GobanView-sidebar {
            position: relative;
          }

          /* Keep its real width: OGS measures this bar to choose available actions. */
          html.${ACTIVE_CLASS}.ogs-custom-dock .GobanView.Game .GobanView-tab-bar {
            position: absolute !important;
            right: 0 !important;
            left: 0 !important;
            bottom: 0 !important;
            width: auto !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }

          html.${ACTIVE_CLASS}.ogs-hide-analysis-ui .PlayControls,
          html.${ACTIVE_CLASS}.ogs-hide-analysis-ui .ReviewControls,
          html.${ACTIVE_CLASS}.ogs-hide-analysis-ui .game-analyze-button-bar,
          html.${ACTIVE_CLASS}.ogs-hide-analysis-ui #move-tree-container,
          html.${ACTIVE_CLASS}.ogs-hide-analysis-ui .AIReview {
            display: none !important;
          }

          /* Compact logo navigation and nested hover menus. */
          #ogs-top-left-nav {
            position: fixed;
            top: 1px;
            left: 45px;
            z-index: 10020;
            width: 82px;
            height: 82px;
            font-family: Nunito, sans-serif;
          }

          #ogs-top-left-logo {
            display: block;
            width: 80px;
            height: 80px;
            opacity: 0.58;
            transition: opacity 160ms ease, transform 160ms ease;
          }

          #ogs-top-left-logo img {
            width: 80px;
            height: 80px;
            filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.45));
          }

          #ogs-cosmetic-gotv {
            position: fixed;
            top: 20px;
            left: 139px;
            z-index: 10020;
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            padding: 0.25rem 0.5rem;
            color: #eee;
            text-decoration: none;
          }

          #ogs-cosmetic-gotv .fa-tv {
            font-size: 1.4rem;
          }

          #ogs-cosmetic-gotv .count {
            font-size: 0.8rem;
            line-height: 1.2;
            text-shadow: 0 1px 3px #000;
          }

          #ogs-top-left-nav:hover #ogs-top-left-logo,
          #ogs-top-left-nav:focus-within #ogs-top-left-logo {
            opacity: 1;
            transform: scale(1.025);
          }

          #ogs-logo-menu,
          #ogs-logo-menu .ogs-logo-submenu {
            list-style: none;
            margin: 0;
            padding: 0.35rem;
            color: #eee;
            background: rgba(20, 20, 20, 0.97);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 7px;
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.48);
          }

          #ogs-logo-menu {
            position: absolute;
            top: 70px;
            left: 0;
            width: 13.5rem;
            max-height: calc(100vh - 82px);
            overflow: visible;
            visibility: hidden;
            opacity: 0;
            pointer-events: none;
            transform: translateY(-5px);
            transition: opacity 130ms ease, transform 130ms ease, visibility 130ms;
          }

          #ogs-top-left-nav:hover > #ogs-logo-menu,
          #ogs-top-left-nav:focus-within > #ogs-logo-menu {
            visibility: visible;
            opacity: 1;
            pointer-events: auto;
            transform: translateY(0);
          }

          html.ogs-logo-menu-dismissed #ogs-logo-menu {
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
            transform: translateY(-5px) !important;
          }

          #ogs-logo-menu li {
            position: relative;
          }

          #ogs-logo-menu a,
          #ogs-logo-menu button {
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.75rem;
            width: 100%;
            min-height: 2.15rem;
            padding: 0.42rem 0.65rem;
            margin: 0 !important;
            border: 0;
            border-radius: 4px;
            color: #eee;
            background: transparent;
            box-shadow: none;
            font: inherit;
            text-align: left;
            text-decoration: none;
            white-space: nowrap;
            cursor: pointer;
            appearance: none;
            text-indent: 0 !important;
          }

          #ogs-logo-menu .ogs-menu-label {
            flex: 1 1 auto !important;
            margin: 0 !important;
            padding: 0 !important;
            text-align: left !important;
          }

          #ogs-logo-menu button > .ogs-menu-label {
            transform: translateX(-0.7rem) !important;
          }

          #ogs-logo-menu a:hover,
          #ogs-logo-menu a:focus,
          #ogs-logo-menu button:hover,
          #ogs-logo-menu button:focus {
            outline: none;
            color: #fff;
            background: rgba(255, 255, 255, 0.12);
          }

          #ogs-logo-menu .ogs-menu-caret {
            opacity: 0.6;
            font-size: 0.75rem;
          }

          #ogs-logo-menu .ogs-logo-submenu {
            position: absolute;
            top: -0.35rem;
            left: calc(100% + 0.2rem);
            min-width: 14.5rem;
            max-width: min(22rem, calc(100vw - 18rem));
            max-height: calc(100vh - 1rem);
            overflow-y: auto;
            visibility: hidden;
            opacity: 0;
            pointer-events: none;
            transform: translateX(-4px);
            transition: opacity 120ms ease, transform 120ms ease, visibility 120ms;
          }

          #ogs-logo-menu li:hover > .ogs-logo-submenu,
          #ogs-logo-menu li:focus-within > .ogs-logo-submenu {
            visibility: visible;
            opacity: 1;
            pointer-events: auto;
            transform: translateX(0);
          }

          /* Collapsed right Dock and its expanded hover state. */
          #ogs-cosmetic-dock {
            position: fixed;
            top: 170px;
            right: 0;
            z-index: 10010;
            display: flex;
            flex-direction: column;
            width: var(--dock-width);
            max-height: calc(100vh - 185px);
            overflow-y: auto;
            padding: 0.35rem;
            box-sizing: border-box;
            color: #ddd;
            background: rgba(20, 20, 20, 0.96);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-right: 0;
            border-radius: 8px 0 0 8px;
            box-shadow: 0 5px 18px rgba(0, 0, 0, 0.4);
            opacity: 0.58;
            transform: translateX(calc(100% - 2.8rem));
            transition: opacity 150ms ease, transform 180ms ease;
          }

          #ogs-cosmetic-dock:hover,
          #ogs-cosmetic-dock:focus-within {
            opacity: 1;
            transform: translateX(0);
          }

          #ogs-cosmetic-dock:not(:hover):not(:focus-within) button > span,
          #ogs-cosmetic-dock:not(:hover):not(:focus-within) a > span {
            opacity: 0;
          }

          #ogs-cosmetic-dock:not(:hover):not(:focus-within) i,
          #ogs-cosmetic-dock:not(:hover):not(:focus-within) img {
            opacity: 1 !important;
            color: #f2f2f2 !important;
            transform: translateX(-0.55rem) !important;
          }

          #ogs-cosmetic-dock[hidden] {
            display: none !important;
          }

          #ogs-cosmetic-dock button,
          #ogs-cosmetic-dock a {
            display: flex !important;
            align-items: center;
            justify-content: flex-start !important;
            gap: 0.45rem;
            width: 100%;
            min-height: 2.15rem;
            padding: 0.35rem 0.5rem;
            border: 0;
            border-radius: 4px;
            color: inherit;
            background: transparent;
            box-shadow: none;
            font: inherit;
            line-height: 1.2;
            text-align: left;
            text-decoration: none;
            white-space: nowrap;
            cursor: pointer;
          }

          #ogs-cosmetic-dock button:hover,
          #ogs-cosmetic-dock button:focus,
          #ogs-cosmetic-dock a:hover,
          #ogs-cosmetic-dock a:focus,
          #ogs-cosmetic-dock .active {
            outline: none;
            color: #fff;
            background: rgba(255, 255, 255, 0.11);
          }

          #ogs-cosmetic-dock button:disabled {
            opacity: 0.35;
            cursor: not-allowed;
          }

          #ogs-cosmetic-dock i,
          #ogs-cosmetic-dock img {
            order: 0 !important;
            flex: 0 0 1.8rem !important;
            width: 20px;
            height: 20px;
            font-size: 16px;
            object-fit: contain;
            margin: 0 !important;
            text-align: center;
          }

          #ogs-cosmetic-dock button > span,
          #ogs-cosmetic-dock a > span {
            order: 1 !important;
            flex: 1 1 auto !important;
            min-width: 0;
            margin: 0 !important;
            padding: 0 !important;
            text-align: left !important;
          }

          .popover-container.ogs-cosmetic-native-panel {
            position: fixed !important;
            top: 120px !important;
            right: calc(var(--dock-width) + 0.65rem) !important;
            bottom: auto !important;
            left: auto !important;
            z-index: 10018 !important;
            max-height: calc(100vh - 140px) !important;
            overflow-x: hidden !important;
            overflow-y: auto !important;
            color: var(--fg);
            background: var(--shade5, #222) !important;
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55) !important;
          }

          html.${ACTIVE_CLASS}.ogs-hide-rematch .ogs-cosmetic-rematch {
            display: none !important;
          }

          #ogs-cosmetic-dock .ogs-dock-volume {
            box-sizing: border-box;
            display: flex;
            align-items: center;
            gap: 0.45rem;
            width: 100%;
            min-height: 2.15rem;
            padding: 0.35rem 0.5rem 0.35rem 1.3rem;
          }

          #ogs-cosmetic-dock .ogs-dock-volume input[type='range'] {
            flex: 1 1 auto;
            min-width: 0;
            margin: 0;
            cursor: pointer;
            transition: opacity 120ms ease;
          }

          #ogs-cosmetic-dock:not(:hover):not(:focus-within) .ogs-dock-volume input[type='range'] {
            opacity: 0;
            pointer-events: none;
          }

          #ogs-cosmetic-dock .ogs-dock-toggle .ogs-dock-switch {
            position: relative;
            order: 2 !important;
            flex: 0 0 2.35rem !important;
            width: 2.35rem;
            height: 1.2rem;
            min-width: 2.35rem;
            margin: 0 0 0 auto !important;
            padding: 0 !important;
            border-radius: 999px;
            background: #777;
            transition: background-color 120ms ease;
          }

          #ogs-cosmetic-dock .ogs-dock-toggle .ogs-dock-switch::after {
            content: '';
            position: absolute;
            top: 2px;
            left: 2px;
            width: calc(1.2rem - 4px);
            height: calc(1.2rem - 4px);
            border-radius: 50%;
            background: #fff;
            transition: transform 120ms ease;
          }

          #ogs-cosmetic-dock .ogs-dock-toggle.on .ogs-dock-switch {
            background: #1976d2;
          }

          #ogs-cosmetic-dock .ogs-dock-toggle.on .ogs-dock-switch::after {
            transform: translateX(1.15rem);
          }

          /* Full-width move timing panel. */
          html.${ACTIVE_CLASS}.ogs-move-timing-open .GobanView.Game {
            bottom: 190px !important;
          }

          #ogs-move-timing-panel {
            position: fixed;
            right: 0;
            bottom: 0;
            left: 0;
            z-index: 10008;
            box-sizing: border-box;
            height: 190px;
            padding: 0.45rem 0.65rem 0.55rem;
            color: #eee;
            background: rgba(30, 30, 30, 0.94);
            border-top: 1px solid rgba(255, 255, 255, 0.18);
            font-family: Nunito, sans-serif;
          }

          html.${ACTIVE_CLASS}.ogs-compact-layout .GobanView.Game:not(.portrait) .ogs-cosmetic-left-takeover.active {
            position: fixed !important;
            top: 88px !important;
            right: auto !important;
            bottom: 4px !important;
            left: 4px !important;
            z-index: 10009 !important;
            box-sizing: border-box;
            width: calc(var(--ogs-cosmetic-sidebar-width, 24rem) - 8px) !important;
            max-height: none !important;
            padding: 0.5rem !important;
            overflow-x: hidden !important;
            overflow-y: auto !important;
            color: var(--fg);
            background: var(--shade5, #222) !important;
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
          }

          #ogs-move-timing-panel .ogs-timing-header {
            display: flex;
            align-items: center;
            gap: 0.7rem;
            height: 1.8rem;
          }

          #ogs-move-timing-panel .ogs-timing-title {
            font-weight: 700;
          }

          #ogs-move-timing-panel .ogs-timing-current {
            flex: 1 1 auto;
            color: #bbb;
          }

          #ogs-move-timing-panel .ogs-timing-close {
            width: 1.8rem;
            height: 1.8rem;
            margin: 0 !important;
            padding: 0 !important;
            border: 0;
            color: #ddd;
            background: transparent;
            box-shadow: none;
            cursor: pointer;
          }

          #ogs-move-timing-panel .ogs-timing-chart {
            display: flex;
            align-items: flex-end;
            gap: 1px;
            height: calc(100% - 2rem);
            padding-top: 0.25rem;
            box-sizing: border-box;
            overflow: hidden;
            border-bottom: 1px solid rgba(255, 255, 255, 0.4);
          }

          #ogs-move-timing-panel .ogs-timing-bar {
            position: relative;
            flex: 1 1 2px;
            min-width: 1px;
            min-height: 2px !important;
            padding: 0;
            margin: 0;
            border: 0;
            border-radius: 1px 1px 0 0;
            box-shadow: none;
            cursor: pointer;
          }

          #ogs-move-timing-panel .ogs-timing-bar.black {
            background: #777;
          }

          #ogs-move-timing-panel .ogs-timing-bar.white {
            background: #f2f2f2;
          }

          #ogs-move-timing-panel .ogs-timing-bar.current {
            background: #d7e800;
            box-shadow: 0 0 0 1px #111;
          }

          #ogs-move-timing-panel .ogs-timing-message {
            margin: auto;
            align-self: center;
            color: #bbb;
          }

          @media (max-width: 1099px) {
            .popover-container.ogs-cosmetic-native-panel {
              right: 3.4rem !important;
            }

          }

          /* Background picker dialog. */
          #ogs-background-menu {
            position: fixed;
            top: 100px;
            left: 50%;
            z-index: 10030;
            width: min(28rem, calc(100vw - 2rem));
            padding: 1rem;
            box-sizing: border-box;
            transform: translateX(-50%);
            color: #fff;
            background: #222;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 8px;
            box-shadow: 0 0 18px rgba(0, 0, 0, 0.55);
            font-family: Nunito, sans-serif;
            text-align: center;
          }

          #ogs-background-menu .ogs-background-actions {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 0.5rem;
          }

          #ogs-background-menu button {
            margin: 0;
          }

          /* Small screens keep nested menus inside the visible logo menu. */
          @media (max-width: 650px) {
            #ogs-top-left-nav {
              left: 8px;
              transform: scale(0.72);
              transform-origin: top left;
            }

            #ogs-logo-menu .ogs-logo-submenu {
              position: static;
              display: none;
              max-width: none;
              max-height: 45vh;
              margin-left: 0.7rem;
              border: 0;
              box-shadow: none;
              transform: none;
            }

            #ogs-logo-menu li:hover > .ogs-logo-submenu,
            #ogs-logo-menu li:focus-within > .ogs-logo-submenu {
              display: block;
            }
          }
        `;
        document.head.appendChild(style);
    };

    // Background choices are stored locally and reapplied after OGS rerenders.
    const setCustomBackground = () => {
        let url = DEFAULT_BG;
        let useOgsBackground = false;
        try {
            useOgsBackground = localStorage.getItem(STORAGE_KEYS.backgroundMode) === 'ogs';
            url = localStorage.getItem(STORAGE_KEYS.customBackground) || DEFAULT_BG;
        } catch { /* Storage can be unavailable in private browser contexts. */ }
        const active = FEATURES.customBackground && onSupportedPage() && !useOgsBackground;
        document.documentElement.classList.toggle('ogs-custom-background', active);
        let style = document.getElementById('ogs-cosmetic-background');
        if (!active) {
            style?.remove();
            return;
        }
        if (!style) {
            style = document.createElement('style');
            style.id = 'ogs-cosmetic-background';
            document.head.appendChild(style);
        }
        const css = `html.${ACTIVE_CLASS}.ogs-custom-background {
            background: url(${JSON.stringify(url)}) center / cover no-repeat fixed !important;
        }`;
        if (style.textContent !== css) style.textContent = css;
    };

    // Build a small standalone dialog instead of depending on an OGS modal.
    const backgroundOptionMenu = () => {
        document.getElementById('ogs-background-menu')?.remove();

        const container = document.createElement('div');
        container.id = 'ogs-background-menu';
        container.setAttribute('role', 'dialog');
        container.setAttribute('aria-modal', 'true');
        container.setAttribute('aria-label', 'Set background');
        container.innerHTML = `
          <p style="margin:0 0 0.8rem;font-weight:bold;">Set Background</p>
          <div class="ogs-background-actions">
            <button type="button" data-action="ogs-default">Use OGS Default</button>
            <button type="button" data-action="reset">Use Script Default</button>
            <button type="button" data-action="url">From Image URL</button>
            <button type="button" data-action="upload">Upload from PC</button>
            <button type="button" data-action="close">Cancel</button>
          </div>
        `;
        document.body.appendChild(container);

        container.querySelector('[data-action="ogs-default"]').addEventListener('click', () => {
            localStorage.setItem(STORAGE_KEYS.backgroundMode, 'ogs');
            setCustomBackground();
            container.remove();
        });

        container.querySelector('[data-action="reset"]').addEventListener('click', () => {
            localStorage.removeItem(STORAGE_KEYS.customBackground);
            localStorage.removeItem(STORAGE_KEYS.backgroundMode);
            setCustomBackground();
            container.remove();
        });

        container.querySelector('[data-action="url"]').addEventListener('click', () => {
            const url = prompt('Enter image URL:');
            if (url?.trim()) {
                localStorage.setItem(STORAGE_KEYS.customBackground, url.trim());
                localStorage.removeItem(STORAGE_KEYS.backgroundMode);
                setCustomBackground();
            }
            container.remove();
        });

        container.querySelector('[data-action="upload"]').addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.addEventListener('change', () => {
                const file = input.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.addEventListener('load', () => {
                    try {
                        localStorage.setItem(STORAGE_KEYS.customBackground, reader.result);
                        localStorage.removeItem(STORAGE_KEYS.backgroundMode);
                        setCustomBackground();
                    } catch (error) {
                        console.error('Could not store the custom OGS background:', error);
                        alert('That image is too large to save in browser storage. Try a smaller image.');
                    }
                });
                reader.readAsDataURL(file);
            });
            input.click();
            container.remove();
        });

        container.querySelector('[data-action="close"]').addEventListener('click', () => container.remove());
        container.querySelector('button')?.focus();
    };

    // Logo navigation -------------------------------------------------------

    // The replacement logo is always available, even before OGS mounts its navbar.
    const addTopLeftLogo = () => {
        if (document.getElementById('ogs-top-left-nav')) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'ogs-top-left-nav';
        wrapper.innerHTML = `
          <a id="ogs-top-left-logo" href="/" aria-label="OGS home and navigation">
            <img src="${LOGO_URL}" alt="OGS">
          </a>
          <ul id="ogs-logo-menu" aria-label="OGS navigation"></ul>
        `;
        document.body.appendChild(wrapper);
        wrapper.addEventListener('mouseleave', () => {
            document.documentElement.classList.remove('ogs-logo-menu-dismissed');
        });
        renderNavigation(FALLBACK_NAVIGATION);
    };

    // OGS owns the live stream feed and preference filtering. The page observer
    // mirrors its count, including removing the indicator when OGS removes it.
    const syncGoTVIndicator = () => {
        let indicator = document.getElementById('ogs-cosmetic-gotv');
        const source = document.querySelector('.NavBar a.GoTVIndicator');
        const count = textOf(source?.querySelector('.count'));
        if (!FEATURES.goTVIndicator || !FEATURES.logoNavigation || !isDesktop() || !source || !count) {
            indicator?.remove();
            return;
        }
        if (!indicator) {
            indicator = document.createElement('a');
            indicator.id = 'ogs-cosmetic-gotv';
            indicator.className = 'GoTVIndicator';
            indicator.innerHTML = '<i class="fa fa-tv" aria-hidden="true"></i><span class="count" aria-live="polite" aria-atomic="true"></span>';
            indicator.addEventListener('click', (event) => {
                if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                const nativeLink = document.querySelector('.NavBar a.GoTVIndicator');
                if (nativeLink) {
                    event.preventDefault();
                    nativeLink.click();
                }
            });
            document.body.appendChild(indicator);
        }
        const href = source.getAttribute('href') || '/gotv';
        const title = `GoTV — ${count} live stream${count === '1' ? '' : 's'}`;
        if (indicator.getAttribute('href') !== href) indicator.setAttribute('href', href);
        if (indicator.title !== title) {
            indicator.title = title;
            indicator.setAttribute('aria-label', title);
        }
        const badge = indicator.querySelector('.count');
        if (badge.textContent !== count) badge.textContent = count;
    };

    // Convert a native OGS link/button into the small data shape our menu uses.
    const sourceToItem = (source, key) => {
        if (!source) return null;
        const labelNode = source.querySelector('.MenuLinkTitle') || source;
        const label = textOf(labelNode);
        if (!label) return null;

        if (source.matches('a[href]')) {
            return {
                label,
                href: source.getAttribute('href') || '/',
                external: source.origin !== location.origin || source.target === '_blank',
            };
        }

        navActionSources.set(key, source);
        return { label, actionKey: key };
    };

    // Read one top-level group and its children from the hidden OGS navbar.
    const collectMenu = (root, groupIndex) => {
        const titleSource = Array.from(root.children).find((child) => child.matches?.('.Menu-title'));
        if (!titleSource) return null;

        const label = textOf(titleSource);
        if (!label) return null;

        const titleItem = sourceToItem(titleSource, `${groupIndex}:title`);
        const childContainer = Array.from(root.children).find((child) => child.matches?.('.Menu-children'));
        const childSources = childContainer
            ? Array.from(childContainer.querySelectorAll(':scope > li > a.MenuLink, :scope > li > button.MenuLink'))
            : [];
        const children = childSources
            .map((source, itemIndex) => sourceToItem(source, `${groupIndex}:${itemIndex}`))
            .filter(Boolean);

        return {
            label,
            href: titleItem?.href,
            external: titleItem?.external,
            actionKey: titleItem?.actionKey,
            children,
        };
    };

    // Mirroring the live navbar keeps account and permission-dependent items correct.
    const collectNavigation = () => {
        const navbar = document.querySelector('.NavBar');
        if (!navbar) return null;

        navActionSources.clear();
        const groups = Array.from(navbar.querySelectorAll('nav.left > ul > li:not(.mobile-only)'))
            .map((root, index) => collectMenu(root, `left-${index}`))
            .filter(Boolean);

        groups.push({ label: 'Visual Settings', cosmeticAction: 'visual-settings', dropdown: true });

        const profile = navbar.querySelector('section.right nav.profile');
        if (profile) {
            const account = collectMenu(profile, 'profile');
            if (account) groups.push(account);
        } else {
            const authSources = Array.from(navbar.querySelectorAll('section.right a[href]'));
            const authChildren = authSources
                .map((source, index) => sourceToItem(source, `auth-${index}`))
                .filter(Boolean);
            if (authChildren.length) groups.push({ label: 'Account', children: authChildren });
        }

        return groups.length ? groups : null;
    };

    // Create either a real link or a proxy button for a native OGS action.
    const createMenuControl = (item, isParent = false) => {
        let control;
        if (item.href) {
            control = document.createElement('a');
            control.href = item.href;
            if (item.external) {
                control.target = '_blank';
                control.rel = 'noopener noreferrer';
            }
        } else {
            control = document.createElement('button');
            control.type = 'button';
            if (item.actionKey) {
                control.addEventListener('click', () => navActionSources.get(item.actionKey)?.click());
            } else if (item.cosmeticAction === 'visual-settings') {
                control.addEventListener('click', () => {
                    openVisualSettings();
                    document.documentElement.classList.add('ogs-logo-menu-dismissed');
                    control.blur();
                });
            }
        }

        const label = document.createElement('span');
        label.className = 'ogs-menu-label';
        label.textContent = item.label;
        control.appendChild(label);

        if (isParent) {
            const caret = document.createElement('span');
            caret.className = 'ogs-menu-caret';
            caret.textContent = '▶';
            caret.setAttribute('aria-hidden', 'true');
            control.appendChild(caret);
            control.setAttribute('aria-haspopup', 'true');
        }

        return control;
    };

    // Render a complete menu in one pass to avoid partially updated submenus.
    function renderNavigation(groups) {
        const menu = document.getElementById('ogs-logo-menu');
        if (!menu) return;
        menu.replaceChildren();

        groups.forEach((group) => {
            const item = document.createElement('li');
            const hasChildren = Boolean(group.children?.length);
            const hasDropdown = hasChildren || Boolean(group.dropdown);
            item.appendChild(createMenuControl(group, hasDropdown));

            if (hasChildren) {
                const submenu = document.createElement('ul');
                submenu.className = 'ogs-logo-submenu';
                submenu.setAttribute('aria-label', group.label);
                group.children.forEach((child) => {
                    const childItem = document.createElement('li');
                    childItem.appendChild(createMenuControl(child));
                    submenu.appendChild(childItem);
                });
                item.appendChild(submenu);
            }

            menu.appendChild(item);
        });
    }

    // A signature check prevents unnecessary DOM replacement while OGS is busy.
    const syncNavigation = () => {
        const groups = collectNavigation();
        if (!groups) return;

        const nextSignature = JSON.stringify(groups);
        if (nextSignature === navSignature) return;
        navSignature = nextSignature;
        renderNavigation(groups);
    };

    // Live page layout ------------------------------------------------------

    // OGS owns the original status header, so copy its changing contents below the players.
    const syncGameStateHeader = () => {
        const root = document.querySelector('.GobanView.Game');
        const sidebar = root?.querySelector(':scope > .GobanView-sidebar');
        const source = sidebar?.querySelector(':scope > .GobanView-header');
        const players = sidebar?.querySelector('.GobanView-tab-panel.always .players');
        let relocated = document.getElementById('ogs-relocated-game-header');

        const shouldRelocate = Boolean(
            FEATURES.compactLayout && source && players && isDesktop() && window.innerWidth >= 1100,
        );
        source?.classList.toggle('ogs-header-source', shouldRelocate);
        if (!shouldRelocate) {
            relocated?.remove();
            return;
        }

        if (!relocated) {
            relocated = document.createElement('div');
            relocated.id = 'ogs-relocated-game-header';
            relocated.className = 'GobanView-header ogs-relocated-game-header';
            relocated.setAttribute('aria-live', 'polite');
            relocated.addEventListener('click', (event) => {
                const controls = 'a, button';
                const target = event.target.closest(controls);
                if (!target) return;
                event.preventDefault();
                const index = Array.from(relocated.querySelectorAll(controls)).indexOf(target);
                document.querySelector('.GobanView-sidebar > .ogs-header-source')?.querySelectorAll(controls)[index]?.click();
            });
        }
        if (relocated.previousElementSibling !== players) players.after(relocated);
        if (relocated.innerHTML !== source.innerHTML) relocated.innerHTML = source.innerHTML;
    };

    // Move the native Themes & Visuals takeover into the otherwise empty left column.
    const syncLeftTakeover = () => {
        document.querySelectorAll('.GobanView-tab-panel.takeover').forEach((panel) => {
            const isVisualSettings = FEATURES.compactLayout && isDesktop() && window.innerWidth >= 1100
                && Boolean(panel.querySelector('.GameMoreSettingsPanel, .GameThemeSettingsPanel'));
            panel.classList.toggle(
                'ogs-cosmetic-left-takeover',
                isVisualSettings,
            );
        });
    };

    // The compact layout intentionally omits the large sidebar Rematch button.
    const syncRematchButton = () => {
        document.querySelectorAll('.GobanView-sidebar .PlayControls button').forEach((button) => {
            button.classList.toggle('ogs-cosmetic-rematch', FEATURES.hideRematch && isDesktop() && textOf(button) === 'Rematch');
        });
    };

    /*
     * Analysis mode is not identical on every route: review/demo pages include
     * a move-comment textarea, while game pages can expose only the move tree.
     * Either element can therefore anchor the Dock-safe analysis panel.
     */
    const syncAnalysisLayout = () => {
        const textarea = document.getElementById('game-move-node-text');
        const moveTree = document.getElementById('move-tree-container');
        const compact = FEATURES.compactAnalysis && isDesktop();
        const analysisPanel = (textarea || moveTree)?.closest('.PlayControls > div');
        analysisPanel?.classList.toggle('ogs-cosmetic-dock-safe', compact);
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        textarea.classList.toggle('ogs-cosmetic-move-comments', compact);
        if (!originalCommentRows.has(textarea)) originalCommentRows.set(textarea, textarea.rows);
        const rows = compact ? 1 : originalCommentRows.get(textarea);
        if (textarea.rows !== rows) textarea.rows = rows;
    };

    // Dock controls and OGS preferences ------------------------------------

    // Dock rows are created locally but delegate their actions back to OGS.
    const createDockButton = ({ label, iconClass, iconUrl, onClick, active, disabled }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.title = label;
        button.disabled = Boolean(disabled);
        button.classList.toggle('active', Boolean(active));
        button.addEventListener('click', onClick);

        if (iconUrl) {
            const image = document.createElement('img');
            image.src = iconUrl;
            image.alt = '';
            button.appendChild(image);
        } else {
            const icon = document.createElement('i');
            icon.className = iconClass || 'fa fa-circle-o';
            icon.setAttribute('aria-hidden', 'true');
            button.appendChild(icon);
        }

        const text = document.createElement('span');
        text.textContent = label;
        button.appendChild(text);
        return button;
    };

    // Toggle rows expose their state to screen readers as pressed/unpressed buttons.
    const createDockToggle = ({ label, iconClass, checked, disabled, onClick }) => {
        const button = createDockButton({
            label,
            iconClass,
            disabled,
            onClick,
        });
        button.classList.add('ogs-dock-toggle');
        button.classList.toggle('on', Boolean(checked));
        button.setAttribute('aria-pressed', String(Boolean(checked)));

        const toggle = document.createElement('span');
        toggle.className = 'ogs-dock-switch';
        toggle.setAttribute('aria-hidden', 'true');
        button.appendChild(toggle);
        return button;
    };

    // OGS exposes its sound controller on ogsWindow.sfx; no separate volume is stored here.
    const createDockVolumeControl = () => {
        const row = document.createElement('div');
        row.className = 'ogs-dock-volume';
        row.title = 'Volume';

        const icon = document.createElement('i');
        icon.setAttribute('aria-hidden', 'true');
        row.appendChild(icon);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.01';
        slider.setAttribute('aria-label', 'Volume');

        const getVolume = () => {
            try {
                return Number(ogsWindow.sfx?.getVolume?.('master') ?? 0.5);
            } catch (error) {
                console.debug('Could not read OGS volume:', error);
                return 0.5;
            }
        };
        const updateIcon = (volume) => {
            icon.className = `fa ${volume <= 0 ? 'fa-volume-off' : volume > 0.5 ? 'fa-volume-up' : 'fa-volume-down'}`;
        };

        slider.value = String(getVolume());
        slider.disabled = !ogsWindow.sfx?.setVolume;
        updateIcon(Number(slider.value));
        slider.addEventListener('input', () => {
            const volume = Number(slider.value);
            ogsWindow.sfx?.setVolume?.('master', volume);
            updateIcon(volume);
        });
        slider.addEventListener('change', () => {
            ogsWindow.sfx?.playStonePlacementSound?.(5, 5, 9, 9, 'white');
        });

        row.appendChild(slider);
        return row;
    };

    // Preference access is guarded because these OGS globals arrive after initial page mount.
    const getPreference = (key, fallback = false) => {
        try {
            const value = ogsWindow.preferences?.get?.(key);
            return value == null ? fallback : Boolean(value);
        } catch (error) {
            console.debug(`Could not read OGS preference ${key}:`, error);
            return fallback;
        }
    };

    const aiReviewEnabled = () => Boolean(
        ogsWindow.goban_controller?.ai_review_enabled
        ?? getPreference('ai-review-enabled', false),
    );

    // Some OGS state updates land on the next frame, so refresh both now and once more then.
    const refreshDockState = () => {
        dockSignature = '';
        syncDock();
        requestAnimationFrame(() => {
            dockSignature = '';
            syncDock();
        });
    };

    const toggleAIReview = () => {
        const controller = ogsWindow.goban_controller;
        if (!controller?.toggleAIReview) return;
        controller.toggleAIReview();
        refreshDockState();
    };

    // Find the hidden native tab-bar button that remains the source of truth for an action.
    const findNativeAction = (title, occurrence) => {
        const byId = Array.from(document.querySelectorAll('.GobanView-tab-button'))
            .find((button) => button.dataset.tabId === title);
        if (byId) return byId;
        const matches = Array.from(document.querySelectorAll('.GobanView-tab-bar .GobanView-tab-button'))
            .filter((button) => (button.title || textOf(button)) === title);
        return matches[occurrence] || matches[0];
    };

    // Zen Mode changes presentation only; the analysis state itself remains untouched.
    const toggleAnalysisUI = () => {
        document.documentElement.classList.toggle('ogs-hide-analysis-ui');
        dockSignature = '';
        syncDock();
    };

    // Native OGS panel bridges ---------------------------------------------

    // Adopt a newly opened OGS popover and place it beside the custom Dock.
    const openNativePanel = (title, occurrence) => {
        const existing = document.querySelector('.popover-container.ogs-cosmetic-native-panel');
        const existingBackdrop = existing?.previousElementSibling;
        if (existingBackdrop?.classList.contains('popover-backdrop')) existingBackdrop.click();

        const before = new Set(document.querySelectorAll('.popover-container'));
        findNativeAction(title, occurrence)?.click();

        const adoptPanel = () => {
            const panel = Array.from(document.querySelectorAll('.popover-container'))
                .find((candidate) => !before.has(candidate));
            if (!panel) return;
            panel.classList.add('ogs-cosmetic-native-panel');
        };
        adoptPanel();
        requestAnimationFrame(adoptPanel);
        setTimeout(adoptPanel, 100);
    };

    /*
     * Themes & Visuals is nested inside the native Settings popover. Open that
     * popover invisibly, then activate More Options so OGS creates its normal
     * settings takeover with all of its existing handlers intact.
     */
    const openVisualSettings = () => {
        if (
            visualSettingsOpening
            || document.querySelector('.GobanView-tab-panel.takeover.active .GameMoreSettingsPanel, .GobanView-tab-panel.takeover.active .GameThemeSettingsPanel')
        ) return;
        visualSettingsOpening = true;

        const buttons = Array.from(document.querySelectorAll('.GobanView-tab-bar .GobanView-tab-button'));
        const source = findNativeAction('game-settings') || buttons.find((button) => button.querySelector('i.fa-gear'));
        if (!source) {
            visualSettingsOpening = false;
            return;
        }

        const before = new Set(document.querySelectorAll('.popover-container'));
        source.click();
        let attempts = 0;
        const openMoreOptions = () => {
            const panel = Array.from(document.querySelectorAll('.popover-container'))
                .find((candidate) => !before.has(candidate));
            if (panel) panel.style.visibility = 'hidden';
            const moreOptions = panel?.querySelector('.GameSettingsPanel button.GameSidebarPanel-item .fa-sliders')
                ?.closest('button');
            if (moreOptions) {
                moreOptions.click();
                setTimeout(() => {
                    visualSettingsOpening = false;
                }, 500);
                return;
            }
            if (++attempts < 12) {
                requestAnimationFrame(openMoreOptions);
            } else {
                visualSettingsOpening = false;
                const backdrop = panel?.previousElementSibling;
                if (backdrop?.classList.contains('popover-backdrop')) backdrop.click();
                else panel?.style.removeProperty('visibility');
            }
        };
        openMoreOptions();
    };

    // Proxy one item from OGS's More Actions popover without showing the native menu.
    const triggerMoreAction = (label) => {
        const source = findNativeAction('game-actions') || Array.from(document.querySelectorAll('.GobanView-tab-button'))
            .find((button) => button.querySelector('i.fa-ellipsis-h'));
        if (!source) return;

        const before = new Set(document.querySelectorAll('.popover-container'));
        source.click();
        let attempts = 0;
        const trigger = () => {
            const panel = Array.from(document.querySelectorAll('.popover-container'))
                .find((candidate) => !before.has(candidate));
            if (panel) panel.style.visibility = 'hidden';
            const action = Array.from(panel?.querySelectorAll('.GameActionsPanel .GameSidebarPanel-item') || [])
                .find((item) => textOf(item) === label || (label === 'Download SGF' && item.matches('a[href*="/sgf"]')));
            if (action && !action.disabled && !action.classList.contains('disabled')) {
                panel.style.removeProperty('visibility');
                action.click();
                return;
            }
            if (++attempts < 12) {
                requestAnimationFrame(trigger);
            } else {
                const backdrop = panel?.previousElementSibling;
                if (backdrop?.classList.contains('popover-backdrop')) backdrop.click();
                else panel?.style.removeProperty('visibility');
            }
        };
        trigger();
    };

    // Downloads and move timing -------------------------------------------

    // Direct SGF URLs avoid reopening the native More Actions popover.
    const downloadCurrentSgf = () => triggerMoreAction('Download SGF');

    // Kifubara expects SGF text, not an OGS URL. Open the tab during the click
    // so the asynchronous SGF download does not trigger a popup blocker.
    const openKifubara = async (gameId) => {
        const tab = window.open('about:blank', '_blank');
        if (!tab) {
            alert('Allow popups for OGS to open Kifubara.');
            return;
        }
        tab.opener = null;
        tab.document.title = 'Opening Kifubara';
        tab.document.body.textContent = 'Loading the game SGF for Kifubara…';
        try {
            const response = await fetch(`/api/v1/games/${gameId}/sgf`, { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`OGS returned ${response.status}`);
            const sgf = await response.text();
            if (!/^\s*\(\s*;/.test(sgf)) throw new Error('OGS did not return a valid SGF');
            if (tab.closed) return;
            // Keep SGF out of the URL and read the JSON response across origins.
            // A form POST displays that JSON; ordinary fetch is blocked by CORS.
            const reviewUrl = await new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest !== 'function') {
                    reject(new Error('Save the complete updated script in Tampermonkey, including its permission header.'));
                    return;
                }
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://kifubara.app/api/import',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        Accept: 'application/json',
                    },
                    data: new URLSearchParams({ sgf, source: 'OGS-Tampermonkey', platform: 'ogs' }).toString(),
                    timeout: 60000,
                    onload: (response) => {
                        try {
                            const result = JSON.parse(response.responseText);
                            if (response.status < 200 || response.status >= 300) {
                                throw new Error(result.message || `Kifubara returned ${response.status}`);
                            }
                            const destination = result.review_url || result.review_path;
                            if (typeof destination !== 'string') throw new Error('Kifubara did not return a review URL.');
                            const url = new URL(destination, 'https://kifubara.app');
                            if (url.origin !== 'https://kifubara.app' || !/^\/review\/[^/]+$/.test(url.pathname)) {
                                throw new Error('Kifubara returned an invalid review URL.');
                            }
                            resolve(url.href);
                        } catch (error) {
                            reject(error);
                        }
                    },
                    onerror: () => reject(new Error('Could not reach Kifubara.')),
                    ontimeout: () => reject(new Error('The Kifubara import timed out.')),
                    onabort: () => reject(new Error('The Kifubara import was cancelled.')),
                });
            });
            if (!tab.closed) tab.location.replace(reviewUrl);
        } catch (error) {
            tab.close();
            console.error('Could not open Kifubara:', error);
            alert(`Could not open Kifubara: ${error.message || 'Please try again.'}`);
        }
    };

    // Keep timing labels short enough to fit inside the full-width chart.
    const formatDuration = (seconds) => {
        if (!Number.isFinite(seconds)) return 'No timing data';
        if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
        const minutes = Math.floor(seconds / 60);
        return `${minutes}m ${Math.round(seconds % 60)}s`;
    };

    // OGS stores move times in milliseconds in the third tuple field.
    const normalizeTimingMoves = (moves) => {
        if (!Array.isArray(moves)) return [];
        return moves.map((move, index) => ({
            moveNumber: index + 1,
            color: index % 2 === 0 ? 'black' : 'white',
            seconds: Math.max(0, Number(Array.isArray(move) ? move[2] : move?.time) || 0) / 1000,
        }));
    };

    /*
     * Prefer the already loaded game record. The API is used only when the
     * current controller has no useful timing data. Reopening reloads live timings.
     */
    const loadMoveTiming = async () => {
        const controller = ogsWindow.goban_controller;
        const localMoves = controller?.goban?.config?.moves || controller?.goban?.engine?.config?.moves;
        let moves = normalizeTimingMoves(localMoves);
        if (moves.some((move) => move.seconds > 0)) {
            return moves;
        }

        const route = location.pathname.match(RECORD_ROUTE);
        if (!route) return moves;
        const endpoint = route[1] === 'game'
            ? `/api/v1/games/${route[2]}`
            : `/api/v1/reviews/${route[2]}`;
        const response = await fetch(endpoint, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`OGS returned ${response.status}`);
        const payload = await response.json();
        moves = normalizeTimingMoves(payload?.gamedata?.moves || payload?.moves);
        return moves;
    };

    // Follow the currently displayed move while the user navigates the record.
    const updateMoveTimingSelection = () => {
        const panel = document.getElementById('ogs-move-timing-panel');
        if (!panel) return;
        const controller = ogsWindow.goban_controller;
        const moveNumber = Number(
            controller?.presentedMoveNumber?.() ?? controller?.goban?.engine?.cur_move?.move_number ?? 0,
        );
        if (panel.dataset.currentMove === String(moveNumber)) return;
        panel.dataset.currentMove = String(moveNumber);

        panel.querySelector('.ogs-timing-bar.current')?.classList.remove('current');
        const current = panel.querySelector(`.ogs-timing-bar[data-move="${moveNumber}"]`);
        current?.classList.add('current');
        const readout = panel.querySelector('.ogs-timing-current');
        if (readout) {
            readout.textContent = current
                ? `Move ${moveNumber}: ${current.dataset.duration}`
                : moveNumber > 0 ? `Move ${moveNumber}` : 'At the beginning';
        }
    };

    // Scale against the 95th percentile so one very slow move does not flatten the chart.
    const renderMoveTiming = (panel, moves) => {
        const chart = panel.querySelector('.ogs-timing-chart');
        chart.replaceChildren();
        const positiveTimes = moves.map((move) => move.seconds).filter((time) => time > 0).sort((a, b) => a - b);
        if (!positiveTimes.length) {
            const message = document.createElement('div');
            message.className = 'ogs-timing-message';
            message.textContent = 'No per-move timing data is available for this record.';
            chart.appendChild(message);
            return;
        }

        const scaleIndex = Math.min(positiveTimes.length - 1, Math.floor(positiveTimes.length * 0.95));
        const scale = Math.max(positiveTimes[scaleIndex], 1);
        moves.forEach((move) => {
            const bar = document.createElement('button');
            const duration = formatDuration(move.seconds);
            bar.type = 'button';
            bar.className = `ogs-timing-bar ${move.color}`;
            bar.dataset.move = String(move.moveNumber);
            bar.dataset.duration = duration;
            bar.style.height = `${Math.max(2, Math.min(100, (move.seconds / scale) * 100))}%`;
            bar.title = `Move ${move.moveNumber} (${move.color}): ${duration}`;
            bar.setAttribute('aria-label', bar.title);
            bar.addEventListener('click', () => ogsWindow.goban_controller?.gotoMove?.(move.moveNumber));
            chart.appendChild(bar);
        });
        delete panel.dataset.currentMove;
        updateMoveTimingSelection();
    };

    // Closing invalidates pending fetches so stale data cannot revive an old panel.
    const closeMoveTiming = (refresh = true) => {
        moveTimingRequest += 1;
        document.getElementById('ogs-move-timing-panel')?.remove();
        document.documentElement.classList.remove('ogs-move-timing-open');
        if (moveTimingTimer) clearInterval(moveTimingTimer);
        moveTimingTimer = null;
        dockSignature = '';
        if (refresh && FEATURES.customDock && isDesktop()) syncDock();
    };

    const openMoveTiming = async () => {
        const requestId = ++moveTimingRequest;
        const panel = document.createElement('section');
        panel.id = 'ogs-move-timing-panel';
        panel.setAttribute('aria-label', 'Move timing');
        panel.innerHTML = `
          <div class="ogs-timing-header">
            <span class="ogs-timing-title">Move Timing</span>
            <span class="ogs-timing-current">Loading timing data…</span>
            <button class="ogs-timing-close" type="button" title="Close move timing" aria-label="Close move timing">×</button>
          </div>
          <div class="ogs-timing-chart"><div class="ogs-timing-message">Loading…</div></div>
        `;
        panel.querySelector('.ogs-timing-close').addEventListener('click', () => closeMoveTiming());
        document.body.appendChild(panel);
        document.documentElement.classList.add('ogs-move-timing-open');
        moveTimingTimer = setInterval(updateMoveTimingSelection, 250);
        dockSignature = '';
        syncDock();

        try {
            const moves = await loadMoveTiming();
            if (requestId !== moveTimingRequest || !panel.isConnected) return;
            renderMoveTiming(panel, moves);
        } catch (error) {
            console.error('Could not load OGS move timing:', error);
            const message = panel.querySelector('.ogs-timing-message');
            if (message) message.textContent = 'Move timing could not be loaded for this record.';
        }
    };

    const toggleMoveTiming = () => {
        if (document.getElementById('ogs-move-timing-panel')) closeMoveTiming();
        else void openMoveTiming();
    };

    // Right Dock -----------------------------------------------------------

    /*
     * Rebuild the Dock only when its visible actions or toggle states change.
     * Native tab-bar buttons keep their measured width and serve as action proxies.
     */
    const syncDock = () => {
        if (!FEATURES.customDock || !isDesktop()) return;
        let dock = document.getElementById('ogs-cosmetic-dock');
        if (!dock) {
            dock = document.createElement('aside');
            dock.id = 'ogs-cosmetic-dock';
            dock.setAttribute('aria-label', 'Game tools');
            document.body.appendChild(dock);
        }
        dock.hidden = false;
        const nativeActions = Array.from(document.querySelectorAll('.GobanView-tab-button')).map((source) => ({
            id: source.dataset.tabId || source.title,
            title: source.title || textOf(source),
            iconClass: source.querySelector('i')?.className || 'fa fa-circle-o',
            disabled: source.disabled,
            active: source.classList.contains('active'),
        })).filter((action) => !['game-link', 'game-info', 'game-chat-toggle'].includes(action.id));
        const nextSignature = JSON.stringify({
            route: location.pathname, nativeActions,
            analysisHidden: document.documentElement.classList.contains('ogs-hide-analysis-ui'),
            timing: Boolean(document.getElementById('ogs-move-timing-panel')),
            ai: aiReviewEnabled(),
            controllerReady: Boolean(ogsWindow.goban_controller?.toggleAIReview),
            sfxReady: Boolean(ogsWindow.sfx?.setVolume),
        });
        if (nextSignature === dockSignature) return;
        dockSignature = nextSignature;
        dock.replaceChildren();

        dock.appendChild(createDockVolumeControl());
        dock.appendChild(createDockToggle({
            label: 'Enable AI review', iconClass: 'fa fa-desktop', checked: aiReviewEnabled(),
            disabled: !ogsWindow.goban_controller?.toggleAIReview, onClick: toggleAIReview,
        }));
        dock.appendChild(createDockButton({
            label: 'Download SGF', iconClass: 'fa fa-download',
            disabled: !findNativeAction('game-actions'), onClick: downloadCurrentSgf,
        }));

        // Link, information, and chat controls remain in native OGS menus.
        // Settings and More actions retain their complete native menus and disabled states.
        const appendNativeAction = (action) => {
            const popover = action.id === 'game-settings' || action.id === 'game-actions';
            dock.appendChild(createDockButton({
                label: action.title, iconClass: action.iconClass,
                disabled: action.disabled, active: action.active,
                onClick: () => popover ? openNativePanel(action.id) : findNativeAction(action.id)?.click(),
            }));
        };
        const bottomActionIds = ['game-settings', 'game-actions'];
        nativeActions.filter((action) => !bottomActionIds.includes(action.id)).forEach(appendNativeAction);
        if (FEATURES.customBackground) dock.appendChild(createDockButton({
            label: 'Set Background', iconClass: 'fa fa-image', onClick: backgroundOptionMenu,
        }));
        if (FEATURES.zenMode) dock.appendChild(createDockButton({
            label: 'Zen Mode', iconClass: 'fa fa-eye-slash',
            active: document.documentElement.classList.contains('ogs-hide-analysis-ui'), onClick: toggleAnalysisUI,
        }));
        const gameId = location.pathname.match(GAME_ROUTE)?.[1];
        if (FEATURES.aiSensei && gameId) dock.appendChild(createDockButton({
            label: 'AI Sensei', iconUrl: 'https://ai-sensei.com/img/Logo_192.png',
            onClick: () => window.open(`https://ai-sensei.com/upload?sgf=${encodeURIComponent(location.href)}`, '_blank', 'noopener'),
        }));
        if (FEATURES.tsumegoDragon && gameId) dock.appendChild(createDockButton({
            label: 'Tsumego Dragon',
            iconUrl: 'https://e7bd43df30278f16e875797cbf0bcce2.cdn.bubble.io/f1721756187167x132460953423929380/Untitled%20design%2834%29.png',
            onClick: () => window.open(`https://tsumegodragon.com/review?ogs_game_id=${gameId}`, '_blank', 'noopener'),
        }));
        if (FEATURES.kifubara && gameId) dock.appendChild(createDockButton({
            label: 'Kifubara', iconUrl: 'https://kifubara.app/static/brand/favicon-32.png',
            onClick: () => void openKifubara(gameId),
        }));
        if (FEATURES.moveTiming && RECORD_ROUTE.test(location.pathname)) dock.appendChild(createDockButton({
            label: 'Move Timing', iconClass: 'fa fa-clock-o',
            active: Boolean(document.getElementById('ogs-move-timing-panel')), onClick: toggleMoveTiming,
        }));
        bottomActionIds.forEach((id) => {
            const action = nativeActions.find((candidate) => candidate.id === id);
            if (action) appendNativeAction(action);
        });
    };

    // Board navigation -----------------------------------------------------

    // Wheel: one move, Shift+wheel: ten moves, Ctrl+wheel: first/last move.
    const navigateWithWheel = (event) => {
        if (!onSupportedPage() || !event.deltaY) return;
        const forward = event.deltaY > 0;
        const method = event.ctrlKey ? (forward ? 'gotoLastMove' : 'gotoFirstMove')
            : event.shiftKey ? (forward ? 'forwardTenMoves' : 'previous10Moves')
                : (forward ? 'nextMove' : 'previousMove');
        const controller = ogsWindow.goban_controller;
        if (typeof controller?.[method] !== 'function') return;
        event.preventDefault();
        event.stopPropagation();
        controller[method]();
    };

    const enableScrollNavigation = () => {
        const goban = FEATURES.wheelNavigation && onSupportedPage()
            ? document.querySelector('.GobanView.Game .goban-container') : null;
        if (goban === boundGoban) return;
        boundGoban?.removeEventListener('wheel', navigateWithWheel, true);
        goban?.addEventListener('wheel', navigateWithWheel, { passive: false, capture: true });
        boundGoban = goban;
    };

    // SPA lifecycle --------------------------------------------------------

    // This is safe to call repeatedly; every helper updates or reuses its own UI.
    const isDesktop = () => {
        const root = document.querySelector('.GobanView.Game');
        return onSupportedPage() && Boolean(root) && !root.matches('.portrait, .mobile');
    };

    const applyPage = () => {
        const active = onSupportedPage();
        const desktop = isDesktop();
        const classes = {
            [ACTIVE_CLASS]: active,
            'ogs-compact-layout': desktop && FEATURES.compactLayout,
            'ogs-logo-navigation': desktop && FEATURES.logoNavigation,
            'ogs-custom-dock': desktop && FEATURES.customDock,
            'ogs-left-ai-review': desktop && FEATURES.compactLayout && FEATURES.leftAIReview,
            'ogs-compact-analysis': desktop && FEATURES.compactAnalysis,
            'ogs-hide-move-controls': desktop && FEATURES.hideMoveControls && FEATURES.wheelNavigation,
            'ogs-hide-rematch': desktop && FEATURES.hideRematch,
        };
        Object.entries(classes).forEach(([name, value]) => document.documentElement.classList.toggle(name, value));
        enableScrollNavigation();
        setCustomBackground();
        syncGoTVIndicator();
        if (!desktop) {
            document.getElementById('ogs-top-left-nav')?.setAttribute('hidden', '');
            document.getElementById('ogs-cosmetic-dock')?.setAttribute('hidden', '');
            document.getElementById('ogs-background-menu')?.remove();
            if (document.getElementById('ogs-move-timing-panel')) closeMoveTiming(false);
            document.documentElement.classList.remove('ogs-hide-analysis-ui');
        }
        syncGameStateHeader();
        syncLeftTakeover();
        syncRematchButton();
        syncAnalysisLayout();
        if (!active) return;
        injectCSS();
        if (desktop && FEATURES.logoNavigation) {
            addTopLeftLogo();
            document.getElementById('ogs-top-left-nav')?.removeAttribute('hidden');
            syncNavigation();
        }
        syncDock();
    };

    // Collapse bursts of React mutations into one update per animation frame.
    const scheduleApply = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            if (location.href !== observedUrl) {
                observedUrl = location.href;
                const record = location.pathname.match(RECORD_ROUTE)?.[0];
                if (record !== observedRecord) {
                    observedRecord = record;
                    closeMoveTiming(false);
                    document.getElementById('ogs-background-menu')?.remove();
                    document.documentElement.classList.remove('ogs-hide-analysis-ui');
                    originalCommentRows.clear();
                }
                navSignature = '';
                dockSignature = '';
            }
            applyPage();
        });
    };

    // Observe the small set of attributes that can change Dock/menu state.
    const start = () => {
        applyPage();
        new MutationObserver(scheduleApply).observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'disabled', 'title', 'rows', 'data-tab-id'],
        });
        // pushState/replaceState do not emit popstate; route cleanup must not depend on a DOM mutation.
        for (const method of ['pushState', 'replaceState']) {
            const original = ogsWindow.history[method];
            ogsWindow.history[method] = function (...args) {
                const result = original.apply(this, args);
                scheduleApply();
                return result;
            };
        }
        window.addEventListener('popstate', scheduleApply);
        window.addEventListener('resize', scheduleApply);
        window.addEventListener('load', scheduleApply, { once: true });
    };

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
