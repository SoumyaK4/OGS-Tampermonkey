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
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

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
    const GAME_ROUTE = /^\/game\/\d+/;
    const REVIEW_ROUTE = /^\/review\//;

    // Native actions in this list are replaced, promoted, or intentionally hidden.
    const HIDDEN_DOCK_ACTIONS = [
        'Tournament',
        'Zen mode',
        'Analyze game',
        'Toggle coordinates',
        'Link to game',
        'Add to library',
        'Download SGF',
        'SGF with comments',
        'Link to review',
        'Review this game',
    ];
    const PROMOTED_MORE_ACTIONS = new Set([
        'Game information',
        'Estimate score',
        'Download SGF',
    ]);
    const CUSTOM_MORE_ACTIONS = [
        { label: 'Fork game', iconClass: 'fa fa-code-fork' },
        { label: 'Call moderator', iconClass: 'fa fa-warning' },
        { label: 'Link to game', iconClass: 'fa fa-share-alt' },
        { label: 'Add to library', iconClass: 'fa fa-plus' },
    ];

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
    let moreMenuOutsideHandler = null;
    const moveTimingCache = new Map();
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
          :root {
            --dock-width: 15rem !important;
            --ogs-cosmetic-sidebar-width: clamp(20rem, 25vw, 24rem);
          }

          html.${ACTIVE_CLASS},
          html.${ACTIVE_CLASS} body {
            min-height: 100%;
            margin: 0;
            background-color: transparent !important;
          }

          html.${ACTIVE_CLASS} .NavBar,
          html.${ACTIVE_CLASS} .AccessibilityMenu,
          html.${ACTIVE_CLASS} .Announcements,
          html.${ACTIVE_CLASS} .SiteHeader,
          html.${ACTIVE_CLASS} .TopBar,
          html.${ACTIVE_CLASS} .NavigationBar,
          html.${ACTIVE_CLASS} .action-bar,
          html.${ACTIVE_CLASS} .left-col {
            display: none !important;
          }

          html.${ACTIVE_CLASS} #main-content,
          html.${ACTIVE_CLASS} #default-variant-container {
            background-color: transparent !important;
          }

          html.${ACTIVE_CLASS}.ogs-native-background,
          html.${ACTIVE_CLASS}.ogs-native-background body,
          html.${ACTIVE_CLASS}.ogs-native-background #main-content,
          html.${ACTIVE_CLASS}.ogs-native-background #default-variant-container {
            background-image: none !important;
            background-color: var(--bg) !important;
          }

          html.${ACTIVE_CLASS} .GobanView.Game {
            top: 0 !important;
            column-gap: 0 !important;
            background: transparent !important;
          }

          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .GobanView-center {
            flex: 1 1 auto !important;
            max-width: none !important;
            margin-right: 4px !important;
          }

          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .GobanView-center,
          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .goban-container {
            background: transparent !important;
          }

          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .GobanView-sidebar {
            width: var(--ogs-cosmetic-sidebar-width) !important;
            margin: 4px 4px 4px 0 !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }

          @media (min-width: 1100px) {
            html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .GobanView-center {
              margin-left: calc(var(--ogs-cosmetic-sidebar-width) + 8px) !important;
            }

            html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .AIReview:not(:empty) {
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

            html.${ACTIVE_CLASS}.ogs-move-timing-open .GobanView.Game:not(.portrait) .AIReview:not(:empty) {
              bottom: 194px;
            }

            html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .AIReview .ai-review-togglers {
              justify-content: center !important;
              align-items: center !important;
              gap: 0.65rem;
            }

            html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .AIReview .ai-review-togglers .left-section {
              display: none !important;
            }

            html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .AIReview .ai-review-togglers .middle-section,
            html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .AIReview .ai-review-togglers .right-section {
              flex: 0 0 auto !important;
            }

            html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .GobanView-sidebar > .GobanView-header {
              display: none !important;
            }

            html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .ogs-relocated-game-header {
              display: block;
              width: 100%;
              box-sizing: border-box;
              border-radius: 0;
            }

            html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .ogs-relocated-game-header:empty {
              display: none;
            }
          }

          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .GobanView-sidebar-content {
            padding: 0 !important;
            background: transparent !important;
          }

          html.${ACTIVE_CLASS} .GobanView.Game .GobanView-header {
            box-sizing: border-box;
            min-height: 0 !important;
            padding: 0.14rem 0.45rem !important;
            font-size: 0.9rem !important;
            line-height: 1.1 !important;
          }

          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .GobanView-tab-panel.always,
          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .GameChat,
          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .chat-container,
          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .log-player-container,
          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .chat-log-container,
          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .chat-log,
          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .chat-log-spacer,
          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .chat-log-inner {
            background: transparent !important;
          }

          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .MoveNumberSlider {
            display: none !important;
          }

          html.${ACTIVE_CLASS} #game-move-node-text.ogs-cosmetic-move-comments {
            display: block;
            box-sizing: border-box;
            width: calc(100% + 1rem);
            margin-left: -0.5rem;
            resize: both !important;
          }

          html.${ACTIVE_CLASS} .PlayControls > .ogs-cosmetic-dock-safe {
            box-sizing: border-box;
            width: calc(100% - 3.2rem) !important;
          }

          html.${ACTIVE_CLASS} .ogs-cosmetic-dock-safe > .game-analyze-button-bar {
            display: grid;
            grid-template-columns: repeat(6, minmax(0, 1fr));
            width: min(calc(100% - 1rem), 20rem);
            margin-right: auto;
            margin-left: auto;
          }

          html.${ACTIVE_CLASS} .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group {
            display: flex;
            width: 100%;
          }

          html.${ACTIVE_CLASS} .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(1),
          html.${ACTIVE_CLASS} .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(4),
          html.${ACTIVE_CLASS} .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(5) {
            grid-column: 1 / -1;
          }

          html.${ACTIVE_CLASS} .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(2) {
            grid-column: 1 / span 3;
          }

          html.${ACTIVE_CLASS} .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(3) {
            grid-column: 4 / span 3;
          }

          html.${ACTIVE_CLASS} .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(-n + 5) > button,
          html.${ACTIVE_CLASS} .ogs-cosmetic-dock-safe > .game-analyze-button-bar > .btn-group:nth-child(-n + 5) > input {
            flex: 1 1 0;
            width: auto;
            min-width: 0;
          }

          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .GobanView-tab-bar {
            position: absolute !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 1px !important;
            min-width: 0 !important;
            height: 1px !important;
            min-height: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            opacity: 0 !important;
            overflow: hidden !important;
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
            background: rgba(25, 25, 25, 0.98) !important;
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55) !important;
          }

          .popover-container.ogs-cosmetic-native-panel .ogs-cosmetic-moved-action {
            display: none !important;
          }

          .ogs-cosmetic-rematch {
            display: none !important;
          }

          /* Script-owned More Actions menu. */
          #ogs-cosmetic-more-menu {
            position: fixed;
            z-index: 10030;
            box-sizing: border-box;
            width: 17rem;
            padding: 0.35rem;
            color: #eee;
            background: rgba(20, 20, 20, 0.97);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 8px;
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.5);
            font-family: Nunito, sans-serif;
          }

          #ogs-cosmetic-more-menu button {
            box-sizing: border-box;
            display: flex;
            align-items: center;
            gap: 0.65rem;
            width: 100%;
            min-height: 2.65rem;
            margin: 0 !important;
            padding: 0.45rem 0.65rem;
            border: 0;
            border-radius: 4px;
            color: inherit;
            background: transparent;
            box-shadow: none;
            font: inherit;
            text-align: left;
            cursor: pointer;
          }

          #ogs-cosmetic-more-menu button:hover,
          #ogs-cosmetic-more-menu button:focus {
            outline: none;
            color: #fff;
            background: rgba(255, 255, 255, 0.12);
          }

          #ogs-cosmetic-more-menu i {
            flex: 0 0 1.8rem;
            width: 1.8rem;
            color: #bbb;
            text-align: center;
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

          html.${ACTIVE_CLASS} .GobanView.Game:not(.portrait) .ogs-cosmetic-left-takeover.active {
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
            background: rgba(25, 25, 25, 0.96) !important;
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
        const useOgsBackground = localStorage.getItem(STORAGE_KEYS.backgroundMode) === 'ogs';
        document.documentElement.classList.toggle('ogs-native-background', useOgsBackground);

        if (useOgsBackground) {
            [document.documentElement, document.getElementById('default-variant-container')].forEach((element) => {
                element?.style.removeProperty('background-image');
                element?.style.removeProperty('background-size');
                element?.style.removeProperty('background-position');
                element?.style.removeProperty('background-repeat');
                element?.style.removeProperty('background-color');
            });
            return;
        }

        const url = localStorage.getItem(STORAGE_KEYS.customBackground) || DEFAULT_BG;
        const background = `url(${JSON.stringify(url)})`;
        const apply = (element) => {
            if (!element) return;
            element.style.setProperty('background-image', background, 'important');
            element.style.setProperty('background-size', 'cover', 'important');
            element.style.setProperty('background-position', 'center', 'important');
            element.style.setProperty('background-repeat', 'no-repeat', 'important');
            element.style.setProperty('background-color', 'transparent', 'important');
        };

        apply(document.documentElement);
        apply(document.getElementById('default-variant-container'));
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
            source && players && !root.classList.contains('portrait') && window.innerWidth >= 1100,
        );
        if (!shouldRelocate) {
            relocated?.remove();
            return;
        }

        if (!relocated) {
            relocated = document.createElement('div');
            relocated.id = 'ogs-relocated-game-header';
            relocated.className = 'GobanView-header ogs-relocated-game-header';
            relocated.setAttribute('aria-live', 'polite');
        }
        if (relocated.previousElementSibling !== players) players.after(relocated);
        if (relocated.innerHTML !== source.innerHTML) relocated.innerHTML = source.innerHTML;
    };

    // Move the native Themes & Visuals takeover into the otherwise empty left column.
    const syncLeftTakeover = () => {
        document.querySelectorAll('.GobanView-tab-panel.takeover').forEach((panel) => {
            const isVisualSettings = Boolean(panel.querySelector('.GameThemeSettingsPanel'));
            panel.classList.toggle(
                'ogs-cosmetic-left-takeover',
                isVisualSettings,
            );
        });
    };

    // The compact layout intentionally omits the large sidebar Rematch button.
    const syncRematchButton = () => {
        document.querySelectorAll('.GobanView-sidebar .PlayControls button').forEach((button) => {
            button.classList.toggle('ogs-cosmetic-rematch', textOf(button) === 'Rematch');
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
        const compact = onSupportedPage();
        const analysisPanel = (textarea || moveTree)?.closest('.PlayControls > div');
        analysisPanel?.classList.toggle('ogs-cosmetic-dock-safe', compact);
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        textarea.classList.toggle('ogs-cosmetic-move-comments', compact);
        const rows = compact ? 1 : 5;
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

    // OGS exposes its sound controller on window.sfx; no separate volume is stored here.
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
                return Number(window.sfx?.getVolume?.('master') ?? 0.5);
            } catch (error) {
                console.debug('Could not read OGS volume:', error);
                return 0.5;
            }
        };
        const updateIcon = (volume) => {
            icon.className = `fa ${volume <= 0 ? 'fa-volume-off' : volume > 0.5 ? 'fa-volume-up' : 'fa-volume-down'}`;
        };

        slider.value = String(getVolume());
        slider.disabled = !window.sfx?.setVolume;
        updateIcon(Number(slider.value));
        slider.addEventListener('input', () => {
            const volume = Number(slider.value);
            window.sfx?.setVolume?.('master', volume);
            updateIcon(volume);
        });
        slider.addEventListener('change', () => {
            window.sfx?.playStonePlacementSound?.(5, 5, 9, 9, 'white');
        });

        row.appendChild(slider);
        return row;
    };

    // Preference access is guarded because these OGS globals arrive after initial page mount.
    const getPreference = (key, fallback = false) => {
        try {
            const value = window.preferences?.get?.(key);
            return value == null ? fallback : Boolean(value);
        } catch (error) {
            console.debug(`Could not read OGS preference ${key}:`, error);
            return fallback;
        }
    };

    const setPreference = (key, value) => {
        try {
            window.preferences?.set?.(key, value);
            return Boolean(window.preferences?.set);
        } catch (error) {
            console.error(`Could not update OGS preference ${key}:`, error);
            return false;
        }
    };

    const chatEnabled = () => getPreference('game.chat-enabled', true);
    const aiReviewEnabled = () => Boolean(
        window.goban_controller?.ai_review_enabled
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

    const toggleChat = () => {
        if (setPreference('game.chat-enabled', !chatEnabled())) refreshDockState();
    };

    const toggleAIReview = () => {
        const controller = window.goban_controller;
        if (!controller?.toggleAIReview) return;
        controller.toggleAIReview();
        refreshDockState();
    };

    // Find the hidden native tab-bar button that remains the source of truth for an action.
    const findNativeAction = (title, occurrence) => {
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
            panel.querySelectorAll('.GameActionsPanel .GameSidebarPanel-item').forEach((item) => {
                if (PROMOTED_MORE_ACTIONS.has(textOf(item))) {
                    item.classList.add('ogs-cosmetic-moved-action');
                }
            });
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
            || document.querySelector('.GobanView-tab-panel.takeover.active .GameThemeSettingsPanel')
        ) return;
        visualSettingsOpening = true;

        const buttons = Array.from(document.querySelectorAll('.GobanView-tab-bar .GobanView-tab-button'));
        const source = buttons.find((button) => button.querySelector('i.fa-gear'));
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
        const source = Array.from(document.querySelectorAll('.GobanView-tab-bar .GobanView-tab-button'))
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
                .find((item) => textOf(item) === label);
            if (action) {
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

    // Custom More Actions menu ---------------------------------------------

    const closeMoreActionsMenu = () => {
        document.getElementById('ogs-cosmetic-more-menu')?.remove();
        if (moreMenuOutsideHandler) {
            document.removeEventListener('pointerdown', moreMenuOutsideHandler, true);
            moreMenuOutsideHandler = null;
        }
    };

    // Position the menu to the left of its Dock button and keep it inside the viewport.
    const toggleMoreActionsMenu = (anchor) => {
        if (document.getElementById('ogs-cosmetic-more-menu')) {
            closeMoreActionsMenu();
            return;
        }

        const menu = document.createElement('div');
        menu.id = 'ogs-cosmetic-more-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'More actions');

        CUSTOM_MORE_ACTIONS.forEach(({ label, iconClass }) => {
            const nativeLabel = label === 'Link to game' && REVIEW_ROUTE.test(location.pathname)
                ? 'Link to review'
                : label;
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('role', 'menuitem');
            button.innerHTML = `<i class="${iconClass}" aria-hidden="true"></i><span>${nativeLabel}</span>`;
            button.addEventListener('click', () => {
                closeMoreActionsMenu();
                triggerMoreAction(nativeLabel);
            });
            menu.appendChild(button);
        });

        document.body.appendChild(menu);
        const bounds = anchor.getBoundingClientRect();
        const left = Math.max(4, bounds.left - menu.offsetWidth - 4);
        const top = Math.max(4, Math.min(bounds.bottom - menu.offsetHeight, window.innerHeight - menu.offsetHeight - 4));
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.querySelector('button')?.focus();

        moreMenuOutsideHandler = (event) => {
            if (!menu.contains(event.target) && !anchor.contains(event.target)) closeMoreActionsMenu();
        };
        setTimeout(() => {
            if (menu.isConnected && moreMenuOutsideHandler) {
                document.addEventListener('pointerdown', moreMenuOutsideHandler, true);
            }
        }, 0);
    };

    // Downloads and move timing -------------------------------------------

    // Direct SGF URLs avoid reopening the native More Actions popover.
    const downloadCurrentSgf = () => {
        const route = location.pathname.match(RECORD_ROUTE);
        if (!route) return;
        const url = route[1] === 'game'
            ? `/api/v1/games/${route[2]}/sgf`
            : `/api/v1/reviews/${route[2]}/sgf?without-comments=1`;
        window.open(url, '_blank', 'noopener');
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
     * current controller has no useful timing data, and results are cached per route.
     */
    const loadMoveTiming = async () => {
        const cacheKey = location.pathname;
        if (moveTimingCache.has(cacheKey)) return moveTimingCache.get(cacheKey);

        const controller = window.goban_controller;
        const localMoves = controller?.goban?.config?.moves || controller?.goban?.engine?.config?.moves;
        let moves = normalizeTimingMoves(localMoves);
        if (moves.some((move) => move.seconds > 0)) {
            moveTimingCache.set(cacheKey, moves);
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
        moveTimingCache.set(cacheKey, moves);
        return moves;
    };

    // Follow the currently displayed move while the user navigates the record.
    const updateMoveTimingSelection = () => {
        const panel = document.getElementById('ogs-move-timing-panel');
        if (!panel) return;
        const controller = window.goban_controller;
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
            bar.addEventListener('click', () => window.goban_controller?.gotoMove?.(move.moveNumber));
            chart.appendChild(bar);
        });
        updateMoveTimingSelection();
    };

    // Closing invalidates pending fetches so stale data cannot revive an old panel.
    const closeMoveTiming = () => {
        moveTimingRequest += 1;
        document.getElementById('ogs-move-timing-panel')?.remove();
        document.documentElement.classList.remove('ogs-move-timing-open');
        if (moveTimingTimer) clearInterval(moveTimingTimer);
        moveTimingTimer = null;
        dockSignature = '';
        syncDock();
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
        panel.querySelector('.ogs-timing-close').addEventListener('click', closeMoveTiming);
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
     * Native tab-bar buttons stay hidden in the page and are used as action proxies.
     */
    const syncDock = () => {
        const root = document.querySelector('.GobanView.Game');
        let dock = document.getElementById('ogs-cosmetic-dock');
        if (!dock) {
            dock = document.createElement('aside');
            dock.id = 'ogs-cosmetic-dock';
            dock.setAttribute('aria-label', 'Game tools');
            document.body.appendChild(dock);
        }

        dock.hidden = Boolean(root?.classList.contains('portrait')) || !onSupportedPage();

        const nativeButtons = Array.from(document.querySelectorAll('.GobanView-tab-bar .GobanView-tab-button'));
        const titleCounts = new Map();
        const nativeActions = nativeButtons
            .map((source) => {
                const title = source.title || textOf(source);
                const occurrence = titleCounts.get(title) || 0;
                titleCounts.set(title, occurrence + 1);
                const icon = source.querySelector('i');
                return {
                    title,
                    occurrence,
                    iconClass: icon?.className || 'fa fa-circle-o',
                    panelKind: icon?.classList.contains('fa-gear')
                        ? 'settings'
                        : icon?.classList.contains('fa-ellipsis-h') ? 'more' : null,
                    disabled: source.disabled,
                    active: source.classList.contains('active'),
                };
            })
            .filter((action) => action.title && !HIDDEN_DOCK_ACTIONS.some((hidden) => action.title.includes(hidden)));

        const nextSignature = JSON.stringify({
            nativeActions,
            analysisHidden: document.documentElement.classList.contains('ogs-hide-analysis-ui'),
            moveTimingEnabled: Boolean(document.getElementById('ogs-move-timing-panel')),
            chatEnabled: chatEnabled(),
            aiReviewEnabled: aiReviewEnabled(),
            sfxReady: Boolean(window.sfx?.setVolume),
        });
        if (nextSignature === dockSignature) return;
        dockSignature = nextSignature;
        closeMoreActionsMenu();
        dock.replaceChildren();
        let moreAction = null;

        const appendPromotedActions = () => {
            dock.appendChild(createDockButton({
                label: 'Game information',
                iconClass: 'fa fa-info',
                onClick: () => triggerMoreAction('Game information'),
            }));
            dock.appendChild(createDockButton({
                label: 'Estimate score',
                iconClass: 'fa fa-tachometer',
                disabled: !window.goban_controller?.estimateScore,
                onClick: () => window.goban_controller?.estimateScore?.(),
            }));
            dock.appendChild(createDockButton({
                label: 'Download SGF',
                iconClass: 'fa fa-download',
                disabled: !RECORD_ROUTE.test(location.pathname),
                onClick: downloadCurrentSgf,
            }));
        };

        const appendSettingsToggles = () => {
            dock.appendChild(createDockToggle({
                label: 'Enable chat',
                iconClass: 'fa fa-comment',
                checked: chatEnabled(),
                disabled: !window.preferences?.set,
                onClick: toggleChat,
            }));
            dock.appendChild(createDockToggle({
                label: 'Enable AI review',
                iconClass: 'fa fa-desktop',
                checked: aiReviewEnabled(),
                disabled: !window.goban_controller?.toggleAIReview,
                onClick: toggleAIReview,
            }));
        };

        nativeActions.forEach((action) => {
            if (action.panelKind === 'more') {
                appendPromotedActions();
                moreAction = action;
                return;
            }
            if (action.panelKind === 'settings') {
                dock.appendChild(createDockVolumeControl());
                appendSettingsToggles();
                return;
            }
            dock.appendChild(createDockButton({
                label: action.title,
                iconClass: action.iconClass,
                disabled: action.disabled,
                active: action.active,
                onClick: () => action.panelKind
                    ? openNativePanel(action.title, action.occurrence)
                    : findNativeAction(action.title, action.occurrence)?.click(),
            }));
        });

        if (GAME_ROUTE.test(location.pathname)) {
            dock.appendChild(createDockButton({
                label: 'Review this game',
                iconClass: 'fa fa-refresh',
                disabled: !window.goban_controller?.startReview,
                onClick: () => window.goban_controller?.startReview?.(),
            }));
        }

        dock.appendChild(createDockButton({
            label: 'Set Background',
            iconClass: 'fa fa-image',
            onClick: backgroundOptionMenu,
        }));
        dock.appendChild(createDockButton({
            label: 'Zen Mode',
            iconClass: document.documentElement.classList.contains('ogs-hide-analysis-ui')
                ? 'fa fa-eye'
                : 'fa fa-eye-slash',
            active: document.documentElement.classList.contains('ogs-hide-analysis-ui'),
            onClick: toggleAnalysisUI,
        }));
        dock.appendChild(createDockButton({
            label: 'AI Sensei',
            iconUrl: 'https://ai-sensei.com/img/Logo_192.png',
            onClick: () => {
                const link = `https://ai-sensei.com/upload?sgf=${encodeURIComponent(location.href)}`;
                window.open(link, '_blank', 'noopener');
            },
        }));
        dock.appendChild(createDockButton({
            label: 'Move Timing',
            iconClass: 'fa fa-clock-o',
            active: Boolean(document.getElementById('ogs-move-timing-panel')),
            onClick: toggleMoveTiming,
        }));
        const moreButton = createDockButton({
            label: 'More actions',
            iconClass: moreAction?.iconClass || 'fa fa-ellipsis-h',
            disabled: !moreAction || moreAction.disabled,
            onClick: () => toggleMoreActionsMenu(moreButton),
        });
        dock.appendChild(moreButton);
    };

    // Board navigation -----------------------------------------------------

    // Wheel: one move, Shift+wheel: ten moves, Ctrl+wheel: first/last move.
    const navigateWithWheel = (event) => {
        event.preventDefault();
        event.stopPropagation();

        const forward = event.deltaY > 0;
        const controller = window.goban_controller;
        if (controller) {
            if (event.ctrlKey) {
                (forward ? controller.gotoLastMove : controller.gotoFirstMove)?.call(controller);
            } else if (event.shiftKey) {
                (forward ? controller.forwardTenMoves : controller.previous10Moves)?.call(controller);
            } else {
                (forward ? controller.nextMove : controller.previousMove)?.call(controller);
            }
            return;
        }

        // Older OGS builds did not expose goban_controller, so retain the button fallback.
        const controls = document.querySelector('.action-bar .controls')?.children;
        if (!controls) return;
        if (event.ctrlKey) {
            (forward ? controls[6] : controls[0])?.click();
        } else if (event.shiftKey) {
            (forward ? controls[5] : controls[1])?.click();
        } else {
            (forward ? controls[4] : controls[2])?.click();
        }
    };

    // Rebind only when OGS replaces the board element during SPA navigation.
    const enableScrollNavigation = () => {
        const goban = document.querySelector('.goban-container');
        if (!goban || goban === boundGoban) return;
        boundGoban?.removeEventListener('wheel', navigateWithWheel, true);
        goban.addEventListener('wheel', navigateWithWheel, { passive: false, capture: true });
        boundGoban = goban;
    };

    // SPA lifecycle --------------------------------------------------------

    // This is safe to call repeatedly; every helper updates or reuses its own UI.
    const applyPage = () => {
        const active = onSupportedPage();
        document.documentElement.classList.toggle(ACTIVE_CLASS, active);
        if (!active) {
            document.getElementById('ogs-top-left-nav')?.setAttribute('hidden', '');
            document.getElementById('ogs-cosmetic-dock')?.setAttribute('hidden', '');
            return;
        }

        injectCSS();
        setCustomBackground();
        addTopLeftLogo();
        document.getElementById('ogs-top-left-nav')?.removeAttribute('hidden');
        syncNavigation();
        syncGameStateHeader();
        syncLeftTakeover();
        syncRematchButton();
        syncAnalysisLayout();
        syncDock();
        enableScrollNavigation();
    };

    // Collapse bursts of React mutations into one update per animation frame.
    const scheduleApply = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            if (location.href !== observedUrl) {
                observedUrl = location.href;
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
            attributeFilter: ['class', 'disabled', 'title', 'rows'],
        });
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
