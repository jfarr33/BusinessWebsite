/**
 * form_runtime.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Vanilla JS runtime for generated forms.
 *
 * Responsibilities:
 *   - Conditional field visibility based on data-conditional attributes
 *   - Client-side form validation feedback
 *   - Serialize all input types to a JSON payload
 *   - Submit JSON to the form's data-submit-endpoint
 *   - Display success / error messages
 *
 * No framework dependencies. Works with both:
 *   - Dynamic Flask preview  (/preview/<id>/<version>)
 *   - Published static pages (published_forms/<id>/<version>/index.html)
 */
(function () {
  'use strict';

  // ── Conditional visibility ─────────────────────────────────────────────────

  /**
   * Read the current value of a named field in the form.
   * Handles radio groups, single checkboxes, checkbox_groups, and all standard inputs.
   */
  function getFieldValue(form, fieldName) {
    var inputs = form.querySelectorAll('[name="' + fieldName + '"]');
    if (!inputs.length) return undefined;

    var first = inputs[0];

    if (first.type === 'radio') {
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].checked) return inputs[i].value;
      }
      return '';
    }

    if (first.type === 'checkbox') {
      // Check if this is part of a checkbox_group (multiple checkboxes with same name)
      if (inputs.length > 1) {
        // checkbox_group: return array of checked values
        var checkedValues = [];
        for (var i = 0; i < inputs.length; i++) {
          if (inputs[i].checked) checkedValues.push(inputs[i].value);
        }
        return checkedValues;
      } else {
        // single checkbox: return boolean/value
        return first.checked ? first.value : '';
      }
    }

    return first.value;
  }

  /**
   * Evaluate a conditional object against the current form state.
   * Supports operators: equals, not_equals, contains, not_empty, empty
   */
  function evaluateCondition(form, condition) {
    var show_if = condition.show_if;
    if (!show_if) return true;

    var fieldValue = getFieldValue(form, show_if.field);
    var testValue  = show_if.value;
    var op         = show_if.operator;

    if (op === 'equals')     return fieldValue === testValue;
    if (op === 'not_equals') return fieldValue !== testValue;
    if (op === 'contains')   {
      // Handle both string contains and array contains
      if (Array.isArray(fieldValue)) {
        return fieldValue.indexOf(testValue) !== -1;
      }
      return typeof fieldValue === 'string' && fieldValue.indexOf(testValue) !== -1;
    }
    if (op === 'not_empty')  return fieldValue !== '' && fieldValue !== undefined && fieldValue !== null && (!Array.isArray(fieldValue) || fieldValue.length > 0);
    if (op === 'empty')      return fieldValue === '' || fieldValue === undefined || fieldValue === null || (Array.isArray(fieldValue) && fieldValue.length === 0);

    return true; // unknown operator — show by default
  }

  /**
   * Re-evaluate all conditional FIELDS and show/hide + enable/disable them.
   * NOTE: Sections are handled by pagination, not by this function.
   */
  function updateConditionals(form) {
    var fields = form.querySelectorAll('[data-conditional]');
    fields.forEach(function (el) {
      // Skip section-level conditionals (they're handled by pagination)
      if (el.classList.contains('form-section')) return;
      
      var condition;
      try {
        condition = JSON.parse(el.dataset.conditional);
      } catch (e) {
        console.warn('[FormEngine] Invalid data-conditional JSON on', el, e);
        return;
      }

      var show = evaluateCondition(form, condition);
      el.style.display = show ? '' : 'none';

      // Disable inputs inside hidden fields so they are excluded from submission
      el.querySelectorAll('input, select, textarea').forEach(function (input) {
        input.disabled = !show;
      });
    });
  }

  // ── Form data serialization ────────────────────────────────────────────────

  /**
   * Serialize the entire form into a plain JSON-safe object.
   * Handles: text, email, tel, date, number, select, textarea, hidden,
   *          radio, checkbox (single), checkbox_group, file metadata.
   *
   * Serialization Rules:
   *   - Text-like fields (text, email, tel, date, number): value or "" if empty
   *   - Single checkbox: boolean (true/false)
   *   - Checkbox group (multiple with same name): ["value1", "value2"] array
   *   - Radio group: selected value string, "" if nothing selected
   *   - Select: selected value or ""
   *   - Textarea: value or ""
   *   - Hidden: value as-is
   *   - File: [{name, size, type}] array or [] if empty
   *
   * Example checkbox group output:
   *   {
   *     "dietary_restrictions": ["gluten-free", "vegan"],
   *     "currently_insured": true
   *   }
   */
  function serializeForm(form) {
    var data = {};
    var elements = form.elements;
    var processedCheckboxGroups = {}; // Track which checkbox groups we've already processed

    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el.name || el.disabled || el.type === 'submit' || el.type === 'button') continue;

      // ── Hidden ──
      if (el.type === 'hidden') {
        data[el.name] = el.value;
        continue;
      }

      // ── Checkbox ──
      if (el.type === 'checkbox') {
        // Skip if this checkbox group has already been processed
        if (processedCheckboxGroups[el.name]) continue;

        // Find all checkboxes with this name (detect checkbox group)
        var siblings = form.querySelectorAll('input[type="checkbox"][name="' + el.name + '"]');
        
        if (siblings.length > 1) {
          // Checkbox group — collect all checked values into an array
          var checked = [];
          siblings.forEach(function (cb) { 
            if (cb.checked) checked.push(cb.value); 
          });
          data[el.name] = checked;
          processedCheckboxGroups[el.name] = true;
        } else {
          // Single checkbox — return boolean (true/false)
          data[el.name] = el.checked;
        }
        continue;
      }

      // ── Radio ──
      if (el.type === 'radio') {
        if (el.checked) {
          data[el.name] = el.value;
        } else if (!(el.name in data)) {
          // No radio in this group is checked — default to empty string
          data[el.name] = '';
        }
        continue;
      }

      // ── File ──
      if (el.type === 'file') {
        if (el.files && el.files.length > 0) {
          data[el.name] = Array.prototype.map.call(el.files, function (f) {
            return { name: f.name, size: f.size, type: f.type };
          });
        } else {
          data[el.name] = [];
        }
        continue;
      }

      // ── All others (text, email, tel, number, date, select, textarea) ──
      data[el.name] = el.value || '';
    }

    return data;
  }

  // ── Validation feedback ────────────────────────────────────────────────────

  function showFieldError(fieldEl, message) {
    fieldEl.classList.add('field-error-active');
    var errEl = document.getElementById(
      (fieldEl.querySelector('input, select, textarea') || {}).name + '_error'
    );
    // Fallback: find by id pattern
    var nameAttr = fieldEl.dataset.fieldName;
    if (nameAttr) errEl = document.getElementById(nameAttr + '_error');

    if (errEl) {
      errEl.textContent = message || 'This field is required.';
      errEl.hidden = false;
    }
  }

  function clearFieldError(fieldEl) {
    fieldEl.classList.remove('field-error-active');
    var nameAttr = fieldEl.dataset.fieldName;
    if (nameAttr) {
      var errEl = document.getElementById(nameAttr + '_error');
      if (errEl) errEl.hidden = true;
    }
  }

  /**
   * Run validation on visible fields and return true if all pass.
   * Pass a section element as the second argument to limit validation to that section.
   */
  function validateForm(form, sectionEl) {
    var valid = true;
    var scope = sectionEl || form;
    var fields = scope.querySelectorAll('.form-field');

    fields.forEach(function (fieldEl) {
      // Skip fields that are conditionally hidden
      if (fieldEl.style.display === 'none') return;
      // Skip fields inside a section hidden by pagination
      var parentSection = fieldEl.closest('.form-section');
      if (parentSection && parentSection.style.display === 'none') return;

      clearFieldError(fieldEl);

      // Validate each input/select/textarea in the field
      var nativeInput = fieldEl.querySelector('input:not([type="radio"]):not([type="checkbox"]), select, textarea');
      if (nativeInput) {
        // For custom-dropdown selects (visually hidden via CSS clip), browser
        // constraint validation is unreliable — check the value directly.
        if (nativeInput.tagName === 'SELECT' && nativeInput.classList.contains('form-select-hidden')) {
          if (nativeInput.required && (nativeInput.value === '' || nativeInput.value === null)) {
            valid = false;
            showFieldError(fieldEl, 'Please select an option.');
            return;
          }
        } else if (!nativeInput.checkValidity()) {
          valid = false;
          showFieldError(fieldEl, nativeInput.validationMessage);
          return;
        }
      }

      // Radio group "required" check (HTML5 required on radios only works
      // if at least one in the group has the required attribute — we use
      // data-required on the fieldset instead)
      var radioGroup = fieldEl.querySelector('fieldset[data-required="true"]');
      if (radioGroup) {
        var checked = radioGroup.querySelector('input[type="radio"]:checked');
        if (!checked) {
          valid = false;
          showFieldError(fieldEl, 'Please select an option.');
        }
      }
    });

    return valid;
  }

  // ── Status messages ────────────────────────────────────────────────────────

  function getOrCreateStatusEl(form) {
    var el = form.querySelector('.form-status-message');
    if (!el) {
      el = document.createElement('div');
      el.className = 'form-status-message';
      var actions = form.querySelector('.form-actions');
      actions ? form.insertBefore(el, actions) : form.appendChild(el);
    }
    return el;
  }

  function showFormMessage(form, message, type) {
    var el = getOrCreateStatusEl(form);
    el.className = 'form-status-message form-status-' + type;
    el.textContent = message;
    el.hidden = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearFormMessage(form) {
    var el = form.querySelector('.form-status-message');
    if (el) el.hidden = true;
  }

  // ── Submit handler ─────────────────────────────────────────────────────────

  function handleSubmit(form) {
    return function (event) {
      event.preventDefault();
      clearFormMessage(form);

      if (!validateForm(form)) {
        showFormMessage(form, 'Please correct the errors above before submitting.', 'error');
        var firstError = form.querySelector('.field-error-active');
        if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      var endpoint = form.dataset.submitEndpoint || '/submit-test';
      var payload  = serializeForm(form);

      // Attach metadata so the server can identify the tenant and form
      if (form.dataset.tenantId)  payload.tenant_id  = form.dataset.tenantId;
      if (form.dataset.formId)    payload.form_id    = form.dataset.formId;
      if (form.dataset.version)   payload.version    = form.dataset.version;

      // Attach the session token so the server can mark the session submitted
      var sessionToken = form.dataset.sessionToken;
      if (sessionToken) payload.session_token = sessionToken;

      console.log('[FormEngine] Submitting to:', endpoint);
      console.log('[FormEngine] Payload:', JSON.stringify(payload, null, 2));

      var submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (response) {
          return response.json().then(function (data) {
            return { ok: response.ok, status: response.status, data: data };
          });
        })
        .then(function (res) {
          if (res.ok) {
            console.log('[FormEngine] Server response:', res.data);
            showFormMessage(form, 'Your information has been submitted successfully.', 'success');
            // Clear the stored session token so the next page load generates a fresh UUID.
            // Without this, refreshing the page reuses the same token and the next
            // test submission just updates the existing row instead of creating a new one.
            var _fid = form.dataset.formId  || 'unknown';
            var _ver = form.dataset.version || 'v1';
            localStorage.removeItem('formEngine_token_' + _fid + '_' + _ver);
            form.dataset.sessionToken = '';
            var _badge = document.getElementById('_debug_token_badge');
            if (_badge) _badge.textContent = 'session: (cleared — refresh for new token)';
            form.reset();
            updateConditionals(form);
          } else {
            var msg = (res.data && res.data.error) ? res.data.error : ('Server returned ' + res.status);
            showFormMessage(form, 'Submission failed: ' + msg, 'error');
          }
        })
        .catch(function (err) {
          console.error('[FormEngine] Fetch error:', err);
          showFormMessage(form, 'Network error: ' + err.message, 'error');
        })
        .finally(function () {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
        });
    };
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  function init() {
    var form = document.getElementById('generated-form');
    if (!form) {
      console.warn('[FormEngine] No #generated-form found on this page.');
      return;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Section-based pagination (page navigation)
    // ────────────────────────────────────────────────────────────────────────
    
    var sections = form.querySelectorAll('.form-section');
    var currentSectionIndex = 0;

    // Helper to check if section is visible (not hidden by conditionals)
    function isSectionVisible(section) {
      if (section.dataset.conditional) {
        try {
          var condition = JSON.parse(section.dataset.conditional);
          return evaluateCondition(form, condition);
        } catch (e) {
          return true;
        }
      }
      return true;
    }

    // Define showSection for use by both pagination and conditional listeners
    function showSection(index) {
      var targetSection = sections[index];
      var targetShouldShow = isSectionVisible(targetSection);
      
      sections.forEach(function (section, i) {
        var isCurrentPage = i === index;
        // Only show the target section if it passes its conditional visibility
        section.style.display = (isCurrentPage && targetShouldShow) ? '' : 'none';
      });

      // Update button states
      var prevBtn = form.querySelector('[data-action="previous-section"]');
      var nextBtn = form.querySelector('[data-action="next-section"]');
      var submitBtn = form.querySelector('[type="submit"]');

      // Find if there's a visible section before current
      var hasPrevVisible = false;
      for (var p = index - 1; p >= 0; p--) {
        if (isSectionVisible(sections[p])) {
          hasPrevVisible = true;
          break;
        }
      }

      // Find if there's a visible section after current
      var hasNextVisible = false;
      for (var n = index + 1; n < sections.length; n++) {
        if (isSectionVisible(sections[n])) {
          hasNextVisible = true;
          break;
        }
      }

      if (prevBtn) prevBtn.style.display = hasPrevVisible ? '' : 'none';
      if (nextBtn) nextBtn.style.display = hasNextVisible ? '' : 'none';
      if (submitBtn) submitBtn.style.display = !hasNextVisible ? '' : 'none';
      var saveBtn = form.querySelector('[data-action="save-later"]');
      if (saveBtn) saveBtn.style.display = hasPrevVisible ? '' : 'none';

      currentSectionIndex = index;
      if (targetShouldShow) {
        targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    // Store showSection on form for access by updateConditionals
    form._showSection = showSection;
    form._isSectionVisible = isSectionVisible;
    form._currentSectionIndex = function() { return currentSectionIndex; };
    form._sections = sections;

    // Listen for input changes to re-evaluate conditionals
    form.addEventListener('change', function () { 
      updateConditionals(form);
      // Refresh pagination UI only if current section is now hidden by conditionals
      if (sections.length > 1 && !isSectionVisible(sections[currentSectionIndex])) {
        var nextIndex = currentSectionIndex + 1;
        while (nextIndex < sections.length && !isSectionVisible(sections[nextIndex])) {
          nextIndex++;
        }
        if (nextIndex >= sections.length) {
          nextIndex = currentSectionIndex - 1;
          while (nextIndex >= 0 && !isSectionVisible(sections[nextIndex])) {
            nextIndex--;
          }
        }
        if (nextIndex >= 0 && nextIndex < sections.length) {
          showSection(nextIndex);
        }
      }
    });
    form.addEventListener('input',  function () { updateConditionals(form); });

    // "Same as mailing address" copy-down for property_1
    form.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'property_1_same_as_mailing') {
        if (e.target.checked) {
          var fieldMap = {
            'property_1_street_address': 'mailing_street_address',
            'property_1_address_line_2': 'mailing_address_line_2',
            'property_1_city':           'mailing_city',
            'property_1_state':          'mailing_state',
            'property_1_zip_code':       'mailing_zip_code'
          };
          Object.keys(fieldMap).forEach(function (dest) {
            var src = form.querySelector('[name="' + fieldMap[dest] + '"]');
            var dst = form.querySelector('[name="' + dest + '"]');
            if (src && dst) {
              dst.value = src.value;
              dst.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        }
        updateConditionals(form);
      }
    });

    // Evaluate initial state (page load)
    updateConditionals(form);

    if (sections.length > 1) {

      // Create Next button if doesn't exist
      var nextBtn = form.querySelector('[data-action="next-section"]');
      if (!nextBtn && form.querySelector('.form-actions')) {
        nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'btn btn-primary';
        nextBtn.textContent = 'NEXT';
        nextBtn.setAttribute('data-action', 'next-section');
        form.querySelector('.form-actions').insertBefore(nextBtn, form.querySelector('[type="submit"]'));
      }

      // Create Previous button if doesn't exist
      var prevBtn = form.querySelector('[data-action="previous-section"]');
      if (!prevBtn && form.querySelector('.form-actions')) {
        prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'btn btn-outline';
        prevBtn.textContent = 'Previous';
        prevBtn.setAttribute('data-action', 'previous-section');
        form.querySelector('.form-actions').insertBefore(prevBtn, form.querySelector('[data-action="next-section"]'));
      }

      // Wire up navigation buttons
      var nextBtn = form.querySelector('[data-action="next-section"]');
      var prevBtn = form.querySelector('[data-action="previous-section"]');

      if (nextBtn) {
        nextBtn.addEventListener('click', function (e) {
          e.preventDefault();
          // Validate current section before advancing
          if (!validateForm(form, sections[currentSectionIndex])) {
            showFormMessage(form, 'Please fill in the required fields before continuing.', 'error');
            var firstError = sections[currentSectionIndex].querySelector('.field-error-active');
            if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
          clearFormMessage(form);
          var nextIndex = currentSectionIndex + 1;
          // Skip hidden sections
          while (nextIndex < sections.length && !isSectionVisible(sections[nextIndex])) {
            nextIndex++;
          }
          if (nextIndex < sections.length) {
            showSection(nextIndex);
          }
        });
      }

      if (prevBtn) {
        prevBtn.addEventListener('click', function (e) {
          e.preventDefault();
          var prevIndex = currentSectionIndex - 1;
          // Skip hidden sections
          while (prevIndex >= 0 && !isSectionVisible(sections[prevIndex])) {
            prevIndex--;
          }
          if (prevIndex >= 0) {
            showSection(prevIndex);
          }
        });
      }

      // Initialize: show only first visible section
      var firstVisibleIndex = 0;
      while (firstVisibleIndex < sections.length && !isSectionVisible(sections[firstVisibleIndex])) {
        firstVisibleIndex++;
      }
      if (firstVisibleIndex < sections.length) {
        showSection(firstVisibleIndex);
      }
    }

    // Wire up form submission
    form.addEventListener('submit', handleSubmit(form));

    // ── Custom select dropdowns ────────────────────────────────────────────
    initCustomSelects(form);

    // ── Session persistence (auto-save + Save and Continue Later) ──────────
    initSessionPersistence(form);

    console.log('[FormEngine] Initialized on form:', form.id);
  }

  // ── Custom select implementation ───────────────────────────────────────────

  function initCustomSelects(container) {
    var selects = container.querySelectorAll('.custom-select');

    selects.forEach(function (cs) {
      var nativeSelect = container.querySelector('select[name="' + cs.dataset.for + '"]');
      var trigger      = cs.querySelector('.custom-select-trigger');
      var dropdown     = cs.querySelector('.custom-select-dropdown');
      var valueEl      = cs.querySelector('.custom-select-value');
      var options      = cs.querySelectorAll('.custom-select-option');

      if (!nativeSelect || !trigger || !dropdown) return;

      // Sync initial display value from native select
      syncDisplayValue();

      function syncDisplayValue() {
        var val = nativeSelect.value;
        var label = null;
        options.forEach(function(o) {
          if (o.dataset.value === val) label = o.textContent.trim();
        });
        if (val === '' || label === null) {
          valueEl.textContent = nativeSelect.options[0] ? nativeSelect.options[0].text : '— Select —';
          valueEl.classList.add('is-placeholder');
        } else {
          valueEl.textContent = label;
          valueEl.classList.remove('is-placeholder');
        }
      }

      function open() {
        trigger.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        dropdown.classList.add('is-open');
        // Position above if not enough space below
        var rect = cs.getBoundingClientRect();
        var spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow < 260) {
          dropdown.style.top = 'auto';
          dropdown.style.bottom = 'calc(100% + 4px)';
        } else {
          dropdown.style.top = '';
          dropdown.style.bottom = '';
        }
      }

      function close() {
        trigger.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
        dropdown.classList.remove('is-open');
      }

      function selectOption(opt) {
        var val = opt.dataset.value;
        // Update native select
        nativeSelect.value = val;
        nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        // Update aria-selected
        options.forEach(function(o) {
          o.classList.toggle('is-selected', o.dataset.value === val && val !== '');
          o.setAttribute('aria-selected', o.dataset.value === val ? 'true' : 'false');
        });
        syncDisplayValue();
        close();
        trigger.focus();
      }

      // Sync custom UI when native select is changed programmatically
      nativeSelect.addEventListener('change', function () {
        syncDisplayValue();
        var val = nativeSelect.value;
        options.forEach(function(o) {
          o.classList.toggle('is-selected', o.dataset.value === val && val !== '');
          o.setAttribute('aria-selected', o.dataset.value === val ? 'true' : 'false');
        });
      });

      // Toggle open/close on trigger click
      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        if (cs.dataset.disabled) return;
        dropdown.classList.contains('is-open') ? close() : open();
      });

      // Select option on click
      options.forEach(function (opt) {
        opt.addEventListener('click', function (e) {
          e.stopPropagation();
          selectOption(opt);
        });
      });

      // Keyboard navigation
      trigger.addEventListener('keydown', function (e) {
        var current, idx, opts;
        switch (e.key) {
          case 'Enter':
          case ' ':
            e.preventDefault();
            dropdown.classList.contains('is-open') ? close() : open();
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (!dropdown.classList.contains('is-open')) open();
            opts = Array.from(options);
            current = dropdown.querySelector('.custom-select-option:focus') || dropdown.querySelector('.is-selected');
            idx = current ? opts.indexOf(current) : -1;
            if (idx < opts.length - 1) opts[idx + 1].focus();
            break;
          case 'ArrowUp':
            e.preventDefault();
            opts = Array.from(options);
            current = dropdown.querySelector('.custom-select-option:focus');
            idx = current ? opts.indexOf(current) : opts.length;
            if (idx > 0) opts[idx - 1].focus();
            break;
          case 'Escape':
            close();
            break;
        }
      });

      dropdown.addEventListener('keydown', function (e) {
        var opts, current, idx;
        switch (e.key) {
          case 'Enter':
          case ' ':
            e.preventDefault();
            current = document.activeElement;
            if (current && current.classList.contains('custom-select-option')) selectOption(current);
            break;
          case 'ArrowDown':
            e.preventDefault();
            opts = Array.from(options);
            current = document.activeElement;
            idx = opts.indexOf(current);
            if (idx < opts.length - 1) opts[idx + 1].focus();
            break;
          case 'ArrowUp':
            e.preventDefault();
            opts = Array.from(options);
            current = document.activeElement;
            idx = opts.indexOf(current);
            if (idx > 0) opts[idx - 1].focus();
            else trigger.focus();
            break;
          case 'Escape':
            e.preventDefault();
            close();
            trigger.focus();
            break;
        }
      });
    });

    // Close all dropdowns on outside click
    document.addEventListener('click', function () {
      container.querySelectorAll('.custom-select-dropdown.is-open').forEach(function (d) {
        var cs = d.closest('.custom-select');
        var trigger = cs && cs.querySelector('.custom-select-trigger');
        d.classList.remove('is-open');
        if (trigger) { trigger.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); }
      });
    });
  }

  // ── Session persistence helpers ────────────────────────────────────────────

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Wire up session persistence for the given form:
   *   - Generates / retrieves a per-form UUID session token in localStorage
   *   - Auto-saves on every Next / Previous navigation (fire-and-forget)
   *   - "Save and Continue Later" button saved explicitly + shows resume link
   *   - Restores form data + section position when URL contains ?resume=<token>
   */
  function initSessionPersistence(form) {
    var formId      = form.dataset.formId   || 'unknown';
    var version     = form.dataset.version  || 'v1';
    var storageKey  = 'formEngine_token_' + formId + '_' + version;

    // Derive tenant from URL path (/<tenant_id>/preview/...) if present
    var pathParts = window.location.pathname.replace(/^\//, '').split('/');
    var knownNonTenant = ['preview', 'published', 'forms', 'admin', 'api'];
    var tenantId = (pathParts[0] && knownNonTenant.indexOf(pathParts[0]) === -1)
      ? pathParts[0] : null;

    function getToken() {
      var t = localStorage.getItem(storageKey);
      if (!t) {
        t = generateUUID();
        localStorage.setItem(storageKey, t);
      }
      return t;
    }

    // Stamp the token on the form element so handleSubmit can include it
    form.dataset.sessionToken = getToken();

    // ── Debug: session token badge (preview only) ───────────────────────────
    function renderTokenBadge() {
      var existing = document.getElementById('_debug_token_badge');
      if (existing) existing.remove();
      var token = form.dataset.sessionToken;
      if (!token) return;
      var badge = document.createElement('div');
      badge.id = '_debug_token_badge';
      badge.style.cssText = [
        'position:fixed', 'bottom:12px', 'right:12px', 'z-index:9999',
        'background:#1e293b', 'color:#94a3b8', 'font-family:monospace',
        'font-size:11px', 'padding:6px 10px', 'border-radius:6px',
        'box-shadow:0 2px 8px rgba(0,0,0,.4)', 'pointer-events:none',
        'max-width:380px', 'word-break:break-all',
      ].join(';');
      badge.textContent = 'session: ' + token;
      document.body.appendChild(badge);
    }
    renderTokenBadge();

    // Restore saved fields + section without blocking the form
    function restoreFields(fields) {
      if (!fields || typeof fields !== 'object') return;
      Object.keys(fields).forEach(function (name) {
        var val = fields[name];
        var radios = form.querySelectorAll('input[type="radio"][name="' + name + '"]');
        if (radios.length) {
          var r = form.querySelector('input[type="radio"][name="' + name + '"][value="' + val + '"]');
          if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
          return;
        }
        var cbs = form.querySelectorAll('input[type="checkbox"][name="' + name + '"]');
        if (cbs.length) {
          if (Array.isArray(val)) {
            cbs.forEach(function (cb) {
              if (val.indexOf(cb.value) !== -1) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
            });
          } else if (val === true || val === 'on' || val === 'yes') {
            cbs[0].checked = true;
            cbs[0].dispatchEvent(new Event('change', { bubbles: true }));
          }
          return;
        }
        var el = form.querySelector('[name="' + name + '"]');
        if (el) {
          el.value = val;
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      updateConditionals(form);
    }

    // Fire-and-forget background save
    function autoSave(sectionIndex) {
      var payload = {
        session_token:   getToken(),
        form_id:         formId,
        form_version:    version,
        tenant_id:       tenantId,
        current_section: sectionIndex,
        form_data:       serializeForm(form),
      };
      fetch('/api/save-session', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      }).catch(function () { /* non-critical — stay silent */ });
    }

    // Explicit save + show confirmation banner
    function saveAndContinueLater() {
      var sectionIdx = form._currentSectionIndex ? form._currentSectionIndex() : 0;
      var token = getToken();
      var payload = {
        session_token:   token,
        form_id:         formId,
        form_version:    version,
        tenant_id:       tenantId,
        current_section: sectionIdx,
        form_data:       serializeForm(form),
      };
      fetch('/api/save-session', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.session_token) {
            showSaveConfirmation(data.session_token);
          } else {
            showSaveError();
          }
        })
        .catch(showSaveError);
    }

    function showSaveConfirmation(token) {
      var resumeUrl = window.location.origin + window.location.pathname + '?resume=' + token;
      var existing  = document.getElementById('save-confirmation-banner');
      if (existing) existing.remove();

      var banner = document.createElement('div');
      banner.id        = 'save-confirmation-banner';
      banner.className = 'save-confirmation-banner';
      banner.innerHTML =
        '<button type="button" class="save-confirmation-close" aria-label="Close">&times;</button>' +
        '<div class="save-confirmation-inner">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>' +
          '<div>' +
            '<strong>Progress saved!</strong> Use this link to continue where you left off:' +
          '</div>' +
        '</div>' +
        '<div class="save-confirmation-link-row">' +
          '<input type="text" class="save-confirmation-link-input" value="' + resumeUrl + '" readonly aria-label="Resume link">' +
          '<button type="button" class="save-confirmation-copy-btn" data-resume-url="' + resumeUrl + '">Copy Link</button>' +
        '</div>';

      var actionsBar = form.querySelector('.form-actions');
      actionsBar.insertAdjacentElement('beforebegin', banner);

      banner.querySelector('.save-confirmation-close').addEventListener('click', function () { banner.remove(); });
      banner.querySelector('.save-confirmation-copy-btn').addEventListener('click', function () {
        var url = this.dataset.resumeUrl;
        var btn = this;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () {
            btn.textContent = 'Copied!';
            setTimeout(function () { btn.textContent = 'Copy Link'; }, 2500);
          });
        } else {
          var inp = banner.querySelector('.save-confirmation-link-input');
          inp.select();
          document.execCommand('copy');
          btn.textContent = 'Copied!';
          setTimeout(function () { btn.textContent = 'Copy Link'; }, 2500);
        }
      });
      banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function showSaveError() {
      var existing = document.getElementById('save-confirmation-banner');
      if (existing) existing.remove();
      var banner = document.createElement('div');
      banner.id        = 'save-confirmation-banner';
      banner.className = 'save-confirmation-banner save-confirmation-error';
      banner.innerHTML =
        '<button type="button" class="save-confirmation-close" aria-label="Close">&times;</button>' +
        '<div class="save-confirmation-inner">' +
          '<strong>Save failed.</strong> Check your connection and try again.' +
        '</div>';
      var actionsBar = form.querySelector('.form-actions');
      actionsBar.insertAdjacentElement('beforebegin', banner);
      banner.querySelector('.save-confirmation-close').addEventListener('click', function () { banner.remove(); });
    }

    // ── Add "Save and Continue Later" button ──────────────────────────────
    var actionsBar = form.querySelector('.form-actions');
    if (actionsBar) {
      var saveBtn = document.createElement('button');
      saveBtn.type      = 'button';
      saveBtn.className = 'btn btn-save-later';
      saveBtn.setAttribute('data-action', 'save-later');
      saveBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>' +
          '<polyline points="17 21 17 13 7 13 7 21"/>' +
          '<polyline points="7 3 7 8 15 8"/>' +
        '</svg> Save &amp; Continue Later';
      saveBtn.addEventListener('click', saveAndContinueLater);
      // Insert as first child so it stays left-aligned
      actionsBar.insertBefore(saveBtn, actionsBar.firstChild);
      // Hidden on first page — showSection will reveal it from page 2 onward
      saveBtn.style.display = 'none';
    }

    // ── Auto-save on navigation (after showSection fires first via bubbling) ─
    form.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action="next-section"], [data-action="previous-section"]');
      if (!btn) return;
      // currentSectionIndex has already been updated by the button's own handler
      var section = form._currentSectionIndex ? form._currentSectionIndex() : 0;
      autoSave(section);
    });

    // ── Resume from ?resume=<token> on page load ───────────────────────────
    var params = new URLSearchParams(window.location.search);
    var resumeToken = params.get('resume');
    if (resumeToken) {
      fetch('/api/resume-session/' + encodeURIComponent(resumeToken))
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (!data || !data.form_data) return;
          // Persist this token for subsequent saves and submits
          localStorage.setItem(storageKey, resumeToken);
          form.dataset.sessionToken = resumeToken;
          restoreFields(data.form_data);
          var savedSection = data.current_section || 0;
          if (form._showSection && savedSection > 0) {
            setTimeout(function () { form._showSection(savedSection); }, 150);
          }
        })
        .catch(function () { /* silent */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Import My Insurance Modal ──────────────────────────────────────────────
  (function initImportModal() {
    var openBtn     = document.getElementById('importInsuranceBtn');
    var modal       = document.getElementById('importInsuranceModal');
    var closeBtn    = document.getElementById('importModalClose');
    var continueBtn = document.getElementById('importContinueBtn');
    var dropzone    = document.getElementById('importDropzone');
    var browseBtn   = document.getElementById('importBrowseBtn');
    var fileInput   = document.getElementById('importFileInput');
    var fileList    = document.getElementById('importFileList');

    if (!openBtn || !modal) return;

    var selectedFiles = [];

    function openModal() {
      modal.removeAttribute('hidden');
      document.body.style.overflow = 'hidden';
      closeBtn && closeBtn.focus();
    }

    function closeModal() {
      modal.setAttribute('hidden', '');
      document.body.style.overflow = '';
      openBtn && openBtn.focus();
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function renderFileList() {
      fileList.innerHTML = '';
      selectedFiles.forEach(function (file, idx) {
        var li = document.createElement('li');
        li.className = 'import-file-item';
        li.innerHTML =
          '<span class="import-file-item-name" title="' + file.name + '">' + file.name + '</span>' +
          '<span class="import-file-item-size">' + formatBytes(file.size) + '</span>' +
          '<button type="button" class="import-file-item-remove" aria-label="Remove ' + file.name + '">&times;</button>';
        li.querySelector('.import-file-item-remove').addEventListener('click', function () {
          selectedFiles.splice(idx, 1);
          renderFileList();
        });
        fileList.appendChild(li);
      });
    }

    function addFiles(files) {
      Array.from(files).forEach(function (f) {
        var exists = selectedFiles.some(function (s) { return s.name === f.name && s.size === f.size; });
        if (!exists) selectedFiles.push(f);
      });
      renderFileList();
    }

    function setButtonState(loading) {
      if (!continueBtn) return;
      continueBtn.disabled = loading;
      continueBtn.textContent = loading ? 'Parsing…' : 'Continue';
      var overlay = document.getElementById('importProcessingOverlay');
      var sub = document.getElementById('importProcessingSub');
      if (overlay) overlay.classList.toggle('active', loading);
      if (sub && loading) {
        var count = selectedFiles.length;
        sub.textContent = 'Reading ' + count + ' document' + (count !== 1 ? 's' : '') + ' with AI — this may take a moment';
      }
    }

    function showImportStatus(msg, isError) {
      var existing = modal.querySelector('.import-status-msg');
      if (existing) existing.remove();
      var p = document.createElement('p');
      p.className = 'import-status-msg';
      p.style.cssText = 'margin:12px 0 0;font-size:.88rem;font-weight:600;' +
        (isError ? 'color:#dc2626;' : 'color:#16a34a;');
      p.textContent = msg;
      fileList.after(p);
    }

    function fillFormFields(fields) {
      var form = document.getElementById('generated-form');
      if (!form) return;
      var filled = 0;
      Object.keys(fields).forEach(function (name) {
        var fieldValue = fields[name];
        
        // Check if this is a radio button group
        var radioButtons = form.querySelectorAll('input[type="radio"][name="' + name + '"]');
        if (radioButtons.length > 0) {
          var selectedRadio = form.querySelector('input[type="radio"][name="' + name + '"][value="' + fieldValue + '"]');
          if (selectedRadio) {
            selectedRadio.checked = true;
            selectedRadio.dispatchEvent(new Event('change', { bubbles: true }));
            selectedRadio.dispatchEvent(new Event('input', { bubbles: true }));
            filled++;
          }
          return;
        }
        
        // Check if this is a checkbox
        var checkboxes = form.querySelectorAll('input[type="checkbox"][name="' + name + '"]');
        if (checkboxes.length > 0) {
          if (Array.isArray(fieldValue)) {
            // Checkbox group — check all matching values
            checkboxes.forEach(function (cb) {
              if (fieldValue.indexOf(cb.value) !== -1) {
                cb.checked = true;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
                cb.dispatchEvent(new Event('input', { bubbles: true }));
                filled++;
              }
            });
          } else if (fieldValue === 'on' || fieldValue === 'yes' || fieldValue === true) {
            checkboxes[0].checked = true;
            checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }));
            checkboxes[0].dispatchEvent(new Event('input', { bubbles: true }));
            filled++;
          }
          return;
        }
        
        // For other input types (text, select, etc.)
        var el = form.querySelector('[name="' + name + '"]');
        if (el) {
          el.value = fieldValue;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
        }
      });
      return filled;
    }

    function checkPropertyToggles(propertyCount) {
      // property_N_add_another must be checked for property N+1 to show.
      var form = document.getElementById('generated-form');
      if (!form || propertyCount < 2) return;
      for (var i = 1; i < propertyCount; i++) {
        var cb = form.querySelector('[name="property_' + i + '_add_another"]');
        if (cb && !cb.checked) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          cb.dispatchEvent(new Event('input',  { bubbles: true }));
        }
      }
      updateConditionals(form);
    }

    function checkVehicleToggles(vehicleCount) {
      // vehicle_N_add_another checkbox must be checked for vehicle N+1 to show.
      // If we have 4 vehicles we need vehicle_1, _2, _3 add_another checked.
      var form = document.getElementById('generated-form');
      if (!form) return;
      for (var i = 1; i < vehicleCount; i++) {
        var cb = form.querySelector('[name="vehicle_' + i + '_add_another"]');
        if (cb && !cb.checked) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          cb.dispatchEvent(new Event('input',  { bubbles: true }));
        }
      }
      // Re-run conditionals after all checkboxes are set
      updateConditionals(form);
    }

    function checkCoApplicantToggle(hasCoApplicant) {
      // If has_co_applicant field is set to "yes", ensure the checkbox is checked.
      var form = document.getElementById('generated-form');
      if (!form || !hasCoApplicant) return;
      var cb = form.querySelector('[name="has_co_applicant"]');
      if (cb && !cb.checked) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        cb.dispatchEvent(new Event('input',  { bubbles: true }));
      }
      updateConditionals(form);
    }

    function checkDriverToggles(driverCount) {
      // driver_N_add_another checkbox must be checked for driver N+1 to show.
      // If we have 3 drivers we need driver_1, _2 add_another checked.
      var form = document.getElementById('generated-form');
      if (!form || driverCount < 2) return;
      for (var i = 1; i < driverCount; i++) {
        var cb = form.querySelector('[name="driver_' + i + '_add_another"]');
        if (cb && !cb.checked) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          cb.dispatchEvent(new Event('input',  { bubbles: true }));
        }
      }
      // Re-run conditionals after all checkboxes are set
      updateConditionals(form);
    }

    openBtn.addEventListener('click', openModal);
    closeBtn && closeBtn.addEventListener('click', closeModal);

    continueBtn && continueBtn.addEventListener('click', function () {
      if (selectedFiles.length === 0) {
        closeModal();
        return;
      }

      setButtonState(true);

      var formData = new FormData();
      selectedFiles.forEach(function (f) { formData.append('files', f); });

      fetch('/api/parse-policy', { method: 'POST', body: formData })
        .then(function (res) {
          var contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) {
            return res.text().then(function (txt) {
              throw new Error('Server returned non-JSON response (HTTP ' + res.status + '): ' + txt.substring(0, 200));
            });
          }
          return res.json().then(function (data) {
            if (!res.ok) throw new Error(data.error || 'Server error ' + res.status);
            return data;
          });
        })
        .then(function (data) {
          setButtonState(false);
          if (data.error) {
            showImportStatus('Error: ' + data.error, true);
            return;
          }
          var vehicleCount = data.vehicles_found || 0;
          var propertyCount = data.properties_found || 0;
          var insureds = data.insureds_found || 0;
          var drivers = data.drivers_found || 0;

          // Enable parent toggles FIRST so child fields become visible
          // Auto-check vehicle toggles if multiple vehicles
          if (vehicleCount > 1) checkVehicleToggles(vehicleCount);

          // Auto-check property toggles if multiple properties
          if (propertyCount > 1) checkPropertyToggles(propertyCount);

          // Auto-check co-applicant toggle if has_co_applicant was set
          if (insureds > 1) checkCoApplicantToggle(true);

          // Auto-check driver toggles if multiple drivers
          if (drivers > 1) checkDriverToggles(drivers);

          // Pass 1: fill all fields — this sets parent toggles (e.g. has_additional_drivers = yes)
          // and triggers updateConditionals to show/enable conditionally hidden fields
          fillFormFields(data.fields || {});

          // Pass 2: fill again now that all conditional fields are visible and enabled
          // (disabled <select> elements do not reliably accept .value in all browsers)
          var form = document.getElementById('generated-form');
          if (form) updateConditionals(form);
          var filled = fillFormFields(data.fields || {});

          // Show success message
          var summary = [];
          if (vehicleCount > 0)  summary.push(vehicleCount + ' vehicle' + (vehicleCount !== 1 ? 's' : ''));
          if (propertyCount > 0) summary.push(propertyCount + ' propert' + (propertyCount !== 1 ? 'ies' : 'y'));
          if (insureds > 0)      summary.push(insureds + ' insured' + (insureds !== 1 ? 's' : ''));
          if (drivers > 0)       summary.push(drivers + ' driver' + (drivers !== 1 ? 's' : ''));

          if (summary.length === 0) {
            showImportStatus('No policy information found in the uploaded documents.', false);
          } else {
            showImportStatus(
              summary.join(', ') + ' found and ' +
              filled + ' field' + (filled !== 1 ? 's' : '') + ' pre-filled.',
              false
            );
            // Close after a short delay so the user sees the success message
            setTimeout(closeModal, 1800);
          }
        })
        .catch(function (err) {
          setButtonState(false);
          showImportStatus('Could not reach the server. Please try again.', true);
          console.error('[ImportModal] parse-policy error:', err);
        });
    });

    // Close on backdrop click
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hasAttribute('hidden')) closeModal();
    });

    // Browse button
    browseBtn && browseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      fileInput.click();
    });

    fileInput && fileInput.addEventListener('change', function () {
      addFiles(fileInput.files);
      fileInput.value = '';
    });

    // Dropzone click
    dropzone && dropzone.addEventListener('click', function (e) {
      if (e.target === browseBtn || browseBtn.contains(e.target)) return;
      fileInput.click();
    });

    // Dropzone keyboard
    dropzone && dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });

    // Drag and drop
    dropzone && dropzone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone && dropzone.addEventListener('dragleave', function (e) {
      if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('drag-over');
    });

    dropzone && dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      addFiles(e.dataTransfer.files);
    });
  })();

  // ── Portal postMessage handlers ──────────────────────────────────────────────
  // PREFILL_FORM  : parent → iframe  : set field values from lead data
  // GET_FORM_DATA : parent → iframe  : request current serialized form data
  // FORM_DATA     : iframe → parent  : response with current serialized form data
  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    if (!event.data) return;
    var form = document.getElementById('generated-form');

    if (event.data.type === 'PREFILL_FORM') {
      if (!form) return;
      var data = event.data.data || {};
      Object.keys(data).forEach(function (key) {
        var el = form.querySelector('[name="' + key + '"]');
        if (!el) return;
        if (el.type === 'checkbox' || el.type === 'radio') return;
        el.value = data[key];
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    if (event.data.type === 'GET_FORM_DATA') {
      var payload = form ? serializeForm(form) : {};
      event.source.postMessage(
        { type: 'FORM_DATA', data: payload },
        event.origin
      );
    }
  });

  // ── Public API for host-page access (no-iframe portal embedding) ──────────
  window.FormRuntime = {
    serializeForm: function () {
      var form = document.getElementById('generated-form');
      return form ? serializeForm(form) : {};
    },
  };

})();
