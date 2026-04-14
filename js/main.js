/**
 * Main JavaScript — Consulting Company Website
 */

(function () {
    'use strict';

    // Set current year in footer
    const yearEl = document.getElementById('current-year');
    if (yearEl) {
        yearEl.textContent = new Date().getFullYear();
    }

    // Mobile navigation toggle
    const navToggle = document.querySelector('.nav-toggle');
    const navMenu = document.getElementById('nav-menu');

    if (navToggle && navMenu) {
        navToggle.addEventListener('click', function () {
            const expanded = this.getAttribute('aria-expanded') === 'true';
            this.setAttribute('aria-expanded', String(!expanded));
            navMenu.classList.toggle('is-open');
        });

        // Close menu when clicking a nav link (mobile)
        navMenu.querySelectorAll('.nav-link').forEach(function (link) {
            link.addEventListener('click', function () {
                navToggle.setAttribute('aria-expanded', 'false');
                navMenu.classList.remove('is-open');
            });
        });
    }

    // Contact form validation
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', function (e) {
            e.preventDefault();
            let isValid = true;

            // Clear previous errors
            contactForm.querySelectorAll('.form-error').forEach(function (el) {
                el.textContent = '';
            });
            contactForm.querySelectorAll('.error').forEach(function (el) {
                el.classList.remove('error');
            });

            // Validate required fields
            var name = contactForm.querySelector('#name');
            var email = contactForm.querySelector('#email');
            var message = contactForm.querySelector('#message');

            if (name && !name.value.trim()) {
                showError(name, 'Please enter your name.');
                isValid = false;
            }

            if (email) {
                if (!email.value.trim()) {
                    showError(email, 'Please enter your email address.');
                    isValid = false;
                } else if (!isValidEmail(email.value.trim())) {
                    showError(email, 'Please enter a valid email address.');
                    isValid = false;
                }
            }

            if (message && !message.value.trim()) {
                showError(message, 'Please enter a message.');
                isValid = false;
            }

            if (isValid) {
                // Form is valid — replace with your submission logic
                var formWrapper = contactForm.closest('.contact-form-wrapper');
                if (formWrapper) {
                    formWrapper.innerHTML = '<div class="form-success">Thank you for your message. We\'ll be in touch shortly.</div>';
                }
            }
        });
    }

    function showError(input, message) {
        input.classList.add('error');
        var errorEl = input.parentElement.querySelector('.form-error');
        if (errorEl) {
            errorEl.textContent = message;
        }
    }

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    // Sticky header shadow on scroll
    var header = document.querySelector('.site-header');
    if (header) {
        window.addEventListener('scroll', function () {
            if (window.scrollY > 10) {
                header.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
            } else {
                header.style.boxShadow = 'none';
            }
        }, { passive: true });
    }
})();
