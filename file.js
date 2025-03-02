// ==UserScript==
// @name         Outlier Task Count & EQ Reason Display (Draggable)
// @namespace    http://tampermonkey.net/
// @version      1.3.10
// @description  Display remaining tasks count and EQ reason on Outlier project pages (excluding /projects/history). Uses a POST request for bulk-remaining-tasks and intercepts two endpoints for the EQ reason: /internal/logged_in_user and /projects/<projectID> (ignoring query parameters like pageLoadId). EQ reason is taken from key "-1" if present, otherwise from "4". Draggable, multi-line textbox.
// @match        https://app.outlier.ai/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    let remainingTaskCount = null;
    let emptyQueueReason = null;
    let lastUrl = window.location.href;

    /**
     * Extracts the CSRF token from the _csrf cookie.
     * @returns {string} The CSRF token, or an empty string if not found.
     */
    function getCsrfToken() {
        const match = document.cookie.match(new RegExp('(^| )_csrf=([^;]+)'));
        return match ? decodeURIComponent(match[2]) : '';
    }

    /**
     * Checks if the current page is a valid project page (i.e., /projects/<id>),
     * excluding the /projects/history page.
     * @returns {boolean}
     */
    function isProjectPage() {
        const parts = window.location.pathname.split('/');
        // Must be under /projects and have a third segment that is not "history"
        return parts[1] === 'projects' && parts[2] && parts[2] !== 'history';
    }

    /**
     * Makes an element draggable by attaching mouse event listeners.
     * @param {HTMLElement} element - The element to be made draggable.
     */
    function makeElementDraggable(element) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        element.addEventListener('mousedown', dragMouseDown);
        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.addEventListener('mousemove', elementDrag);
            document.addEventListener('mouseup', closeDragElement);
        }
        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }
        function closeDragElement() {
            document.removeEventListener('mousemove', elementDrag);
            document.removeEventListener('mouseup', closeDragElement);
        }
    }

    /**
     * Creates or updates a textbox (textarea element) to show the remaining task count and EQ reason.
     */
    function updateTextbox() {
        // Only update if on a valid project page (not /projects/history)
        if (!isProjectPage()) {
            const existing = document.getElementById("tm-outlier-task-count");
            if (existing) existing.remove();
            return;
        }
        let textbox = document.getElementById("tm-outlier-task-count");
        if (!textbox) {
            textbox = document.createElement("textarea");
            textbox.id = "tm-outlier-task-count";
            textbox.style.position = "fixed";
            textbox.style.top = "10px";
            textbox.style.left = "10px";
            textbox.style.zIndex = "9999";
            textbox.style.backgroundColor = "#fff";
            textbox.style.border = "1px solid #ccc";
            textbox.style.padding = "5px";
            textbox.style.fontSize = "14px";
            textbox.style.resize = "none";
            textbox.rows = 2;
            textbox.cols = 40;
            textbox.readOnly = true;
            makeElementDraggable(textbox);
            document.body.appendChild(textbox);
        }
        textbox.value = `Remaining Tasks: ${remainingTaskCount !== null ? remainingTaskCount : 'N/A'}\nEQ Reason: ${emptyQueueReason !== null ? emptyQueueReason : 'N/A'}`;
    }

    /**
     * Parses the current project ID from the URL.
     * Example: in "https://app.outlier.ai/projects/6793e8cbf8009ede610736a7",
     * returns "6793e8cbf8009ede610736a7".
     * @returns {string|null} The project ID or null if not found.
     */
    function getProjectIdFromURL() {
        if (!isProjectPage()) return null;
        const parts = window.location.pathname.split('/');
        return parts[2] || null;
    }

    /**
     * Polls the bulk-remaining-tasks endpoint (using POST) to obtain the remaining task count if it's missing.
     * Runs only on a valid project page.
     */
    function pollForMissingValues() {
        if (!isProjectPage()) return;
        const currentProjectId = getProjectIdFromURL();
        if (!currentProjectId) return;

        if (remainingTaskCount === null) {
            fetch('https://app.outlier.ai/internal/user-projects/bulk-remaining-tasks', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    "accept": "*/*",
                    "content-type": "application/json",
                    "x-csrf-token": getCsrfToken()
                },
                body: JSON.stringify({ projectIds: [ currentProjectId ] })
            })
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data)) {
                    const projectData = data.find(item => item.projectId === currentProjectId);
                    if (projectData && projectData.count !== undefined) {
                        remainingTaskCount = projectData.count;
                        updateTextbox();
                    }
                }
            })
            .catch(e => console.error("Polling bulk-remaining-tasks error:", e));
        }
    }

    /* --- Intercepting fetch --- */
    const originalFetch = window.fetch;
    window.fetch = function() {
        return originalFetch.apply(this, arguments).then(response => {
            const url = response.url;
            if (url.includes("/internal/user-projects/bulk-remaining-tasks")) {
                response.clone().json().then(data => {
                    if (Array.isArray(data)) {
                        const currentProjectId = getProjectIdFromURL();
                        if (currentProjectId) {
                            const projectData = data.find(item => item.projectId === currentProjectId);
                            if (projectData && projectData.count !== undefined) {
                                remainingTaskCount = projectData.count;
                                updateTextbox();
                            }
                        }
                    }
                }).catch(e => {
                    console.error("Error parsing JSON from bulk-remaining-tasks fetch interception:", e);
                });
            } else if (/\/internal\/logged_in_user(\?.*)?$/.test(url)) {
                response.clone().json().then(data => {
                    if (data && data.lastEmptyQueueEvent && data.lastEmptyQueueEvent.emptyQueueReasons) {
                        const currentProjectId = getProjectIdFromURL();
                        if (currentProjectId) {
                            const reasons = data.lastEmptyQueueEvent.emptyQueueReasons;
                            if (reasons[currentProjectId]) {
                                emptyQueueReason = reasons[currentProjectId]["-1"] || reasons[currentProjectId]["4"] || 'N/A';
                            } else {
                                emptyQueueReason = 'N/A';
                            }
                            updateTextbox();
                        }
                    }
                }).catch(e => {
                    console.error("Error parsing JSON from logged_in_user fetch interception:", e);
                });
            } else if (/^https:\/\/app\.outlier\.ai\/projects\/(?!history)[^\/?]+(\?.*)?$/.test(url)) {
                // Intercept the project details request (which is gzipped but auto-decompressed)
                response.clone().json().then(data => {
                    const currentProjectId = getProjectIdFromURL();
                    if (currentProjectId && Array.isArray(data) && data.length > 1 && data[1].lastEmptyQueueEvent && data[1].lastEmptyQueueEvent.emptyQueueReasons) {
                        const reasons = data[1].lastEmptyQueueEvent.emptyQueueReasons;
                        if (reasons[currentProjectId]) {
                            emptyQueueReason = reasons[currentProjectId]["-1"] || reasons[currentProjectId]["4"] || 'N/A';
                        } else {
                            emptyQueueReason = 'N/A';
                        }
                        updateTextbox();
                    }
                }).catch(e => {
                    console.error("Error parsing JSON from /projects/<id> fetch interception:", e);
                });
            }
            return response;
        });
    };

    /* --- Intercepting XMLHttpRequest --- */
    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        return originalXHROpen.apply(this, arguments);
    };

    const originalXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            if (this._url) {
                if (this._url.includes("/internal/user-projects/bulk-remaining-tasks")) {
                    try {
                        const data = JSON.parse(this.responseText);
                        if (Array.isArray(data)) {
                            const currentProjectId = getProjectIdFromURL();
                            if (currentProjectId) {
                                const projectData = data.find(item => item.projectId === currentProjectId);
                                if (projectData && projectData.count !== undefined) {
                                    remainingTaskCount = projectData.count;
                                    updateTextbox();
                                }
                            }
                        }
                    } catch(e) {
                        console.error("Error parsing JSON from bulk-remaining-tasks XHR interception:", e);
                    }
                } else if (/\/internal\/logged_in_user(\?.*)?$/.test(this._url)) {
                    try {
                        const data = JSON.parse(this.responseText);
                        if (data && data.lastEmptyQueueEvent && data.lastEmptyQueueEvent.emptyQueueReasons) {
                            const currentProjectId = getProjectIdFromURL();
                            if (currentProjectId) {
                                const reasons = data.lastEmptyQueueEvent.emptyQueueReasons;
                                if (reasons[currentProjectId]) {
                                    emptyQueueReason = reasons[currentProjectId]["-1"] || reasons[currentProjectId]["4"] || 'N/A';
                                } else {
                                    emptyQueueReason = 'N/A';
                                }
                                updateTextbox();
                            }
                        }
                    } catch(e) {
                        console.error("Error parsing JSON from logged_in_user XHR interception:", e);
                    }
                } else if (/^https:\/\/app\.outlier\.ai\/projects\/(?!history)[^\/?]+(\?.*)?$/.test(this._url)) {
                    try {
                        const data = JSON.parse(this.responseText);
                        const currentProjectId = getProjectIdFromURL();
                        if (currentProjectId && Array.isArray(data) && data.length > 1 && data[1].lastEmptyQueueEvent && data[1].lastEmptyQueueEvent.emptyQueueReasons) {
                            const reasons = data[1].lastEmptyQueueEvent.emptyQueueReasons;
                            if (reasons[currentProjectId]) {
                                emptyQueueReason = reasons[currentProjectId]["-1"] || reasons[currentProjectId]["4"] || 'N/A';
                            } else {
                                emptyQueueReason = 'N/A';
                            }
                            updateTextbox();
                        }
                    } catch(e) {
                        console.error("Error parsing JSON from /projects/<id> XHR interception:", e);
                    }
                }
            }
        });
        return originalXHRSend.apply(this, arguments);
    };

    // Monitor URL changes and poll for missing values.
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            if (isProjectPage()) {
                // Reset data on a new project page and create the textbox.
                remainingTaskCount = null;
                emptyQueueReason = null;
                updateTextbox();
            } else {
                // Remove textbox if not on a valid project page.
                const textbox = document.getElementById("tm-outlier-task-count");
                if (textbox) textbox.remove();
            }
        } else if (isProjectPage() && !document.getElementById("tm-outlier-task-count")) {
            // If on a project page and the textbox doesn't exist, create it.
            updateTextbox();
        }
        // Poll for missing remainingTaskCount only on valid project pages.
        if (isProjectPage() && remainingTaskCount === null) {
            pollForMissingValues();
        }
    }, 500);

})();
