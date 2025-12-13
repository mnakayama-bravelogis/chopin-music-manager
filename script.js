// Data is loaded from data.js via script tag (window.chopinWorks)

// version 2.1.1
// Fail-safe: Inject critical mobile styles directly to bypass CSS caching issues
(function injectMobileStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
        /* Force Hide Mobile Elements on Desktop */
        @media (min-width: 769px) {
            .mobile-only { display: none !important; }
        }

        /* Mobile Styles */
        @media (max-width: 768px) {
            .desktop-only { display: none !important; }
            .mobile-only { display: block !important; } 
            
            /* Specific layout for mobile elements */
            .mobile-card-footer {
                display: flex !important;
                flex-direction: row !important;
                justify-content: space-between !important;
                align-items: center !important;
            }
            .mobile-footer-right {
                 display: flex !important;
                 flex-direction: row !important;
                 gap: 12px !important;
                 align-items: center !important;
            }

            /* Extra safety for the red box elements explicitly */
            td.col-comment, td.col-action {
                display: none !important; 
            }
            /* Re-enable the mobile wrapper which might be a td */
            td.col-mobile-wrapper {
                display: block !important;
                padding: 0 !important;
                border: none !important;
            }
        }
    `;
    document.head.appendChild(style);
    console.log("Mobile styles injected");
})();

document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const authOverlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app-container');
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const authMessage = document.getElementById('auth-message');
    const userEmailSpan = document.getElementById('user-email');

    const songForm = document.getElementById('song-form');
    const submitBtn = document.getElementById('submit-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');

    const opusSelect = document.getElementById('opus-select');
    const noSelect = document.getElementById('no-select');
    const titleInput = document.getElementById('title');
    const genreInput = document.getElementById('genre');
    const yearInput = document.getElementById('year');
    const youtubeContainer = document.getElementById('youtube-container');
    const addYoutubeBtn = document.getElementById('add-youtube-btn');

    const songListBody = document.getElementById('song-list-body');
    const emptyState = document.getElementById('empty-state');
    const tableHeader = document.querySelector('.song-table thead');

    // --- State Management ---
    const STORAGE_KEY = 'chopin_manager_library';
    let library = []; // In-memory cache of DB data
    let currentUser = null;

    // Sort/Filter State
    let sortConfig = { key: 'op', direction: 'asc' };
    let genreFilter = '';
    let editingId = null;

    // --- Initialization ---
    initOpusDropdown();
    initGenreFilter();

    // Check Auth State immediately
    checkAuth();

    // --- Auth Listeners ---
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);

    // Social & Reset Listeners
    document.getElementById('google-login-btn').addEventListener('click', () => handleSocialLogin('google'));
    document.getElementById('apple-login-btn').addEventListener('click', () => handleSocialLogin('apple'));
    document.getElementById('forgot-password-link').addEventListener('click', handlePasswordReset);

    // --- App Listeners ---
    addYoutubeBtn.addEventListener('click', () => addYoutubeInput(''));
    opusSelect.addEventListener('change', handleOpusChange);
    noSelect.addEventListener('change', handleNoChange);

    document.getElementById('genre-filter').addEventListener('change', (e) => {
        genreFilter = e.target.value;
        renderLibrary();
    });
    document.getElementById('genre-filter').addEventListener('click', (e) => e.stopPropagation());

    songForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveSong();
    });

    cancelBtn.addEventListener('click', resetForm);

    tableHeader.addEventListener('click', (e) => {
        const th = e.target.closest('th');
        if (!th || !th.dataset.sort) return;
        const key = th.dataset.sort;
        if (sortConfig.key === key) {
            sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
        } else {
            sortConfig.key = key;
            sortConfig.direction = (key === 'rating') ? 'desc' : 'asc';
        }
        renderLibrary();
    });

    // --- Auth Functions ---

    async function checkAuth() {
        if (!supabase) return;
        const { data: { session } } = await supabase.auth.getSession();
        updateAuthState(session);

        // Listen for changes
        supabase.auth.onAuthStateChange((_event, session) => {
            updateAuthState(session);
        });
    }

    async function updateAuthState(session) {
        if (session) {
            currentUser = session.user;
            userEmailSpan.textContent = currentUser.email;
            authOverlay.style.display = 'none';
            appContainer.style.display = 'block';

            // Check for migration
            checkForMigration();

            // Load Data
            await fetchLibrary();
        } else {
            currentUser = null;
            authOverlay.style.display = 'flex';
            appContainer.style.display = 'none';
            library = [];
        }
    }

    async function handleSocialLogin(provider) {
        authMessage.textContent = `Redirecting to ${provider}...`;
        const { error } = await supabase.auth.signInWithOAuth({
            provider: provider,
            options: {
                redirectTo: window.location.href // Redirect back to this page
            }
        });
        if (error) {
            authMessage.style.color = 'red';
            authMessage.textContent = error.message;
        }
    }

    async function handlePasswordReset(e) {
        e.preventDefault();
        const email = document.getElementById('email').value;
        if (!email) {
            authMessage.style.color = 'orange';
            authMessage.textContent = 'Please enter your email above to reset password.';
            return;
        }

        authMessage.textContent = 'Sending reset link...';
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.href,
        });

        if (error) {
            authMessage.style.color = 'red';
            authMessage.textContent = error.message;
        } else {
            authMessage.style.color = 'green';
            authMessage.textContent = 'Password reset link sent to your email!';
        }
    }

    async function handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        authMessage.style.color = '#555';
        authMessage.textContent = 'Connecting...';
        loginBtn.disabled = true;

        // 1. Try Login
        let { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            console.log('Login Error:', error.message);
            // 2. If login failed, check if it's because user doesn't exist
            if (error.message.includes('Invalid login credentials')) {
                // Try Sign Up
                authMessage.textContent = 'Create new account...';
                const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });

                if (signUpError) {
                    // Sign up failed (maybe user exists but wrong password?)
                    authMessage.style.color = 'red';
                    authMessage.textContent = 'Login Failed: ' + signUpError.message;
                    loginBtn.disabled = false;
                } else {
                    // Sign up succeeded
                    if (signUpData.session) {
                        // Auto logged in (Email confirm disabled)
                        authMessage.textContent = 'Welcome!';
                    } else {
                        // Email confirm required
                        authMessage.style.color = 'green';
                        authMessage.style.fontWeight = 'bold';
                        authMessage.innerHTML = '<i class="fa-solid fa-envelope"></i> Confirmation email sent!<br>Please check your inbox.';
                        loginBtn.disabled = false;
                        loginBtn.querySelector('span').textContent = 'Check Email & Retry';
                    }
                }
            } else if (error.message.includes('Email not confirmed')) {
                authMessage.style.color = 'orange';
                authMessage.textContent = 'Please confirm your email address first.';
                loginBtn.disabled = false;
            } else {
                authMessage.style.color = 'red';
                authMessage.textContent = error.message;
                loginBtn.disabled = false;
            }
        }
    }

    async function handleLogout() {
        await supabase.auth.signOut();
        // The onAuthStateChange listener will handle the UI update (SIGNED_OUT event)
        // No need to force reload, which might confuse the session state
    }

    // --- Data Migration Logic ---
    function checkForMigration() {
        const localData = localStorage.getItem(STORAGE_KEY);
        if (localData && JSON.parse(localData).length > 0) {
            // Show migration banner if not present
            if (!document.getElementById('migration-banner')) {
                const banner = document.createElement('div');
                banner.id = 'migration-banner';
                banner.className = 'migration-banner';
                banner.innerHTML = `
                    <span><i class="fa-solid fa-triangle-exclamation"></i> Found local data on this device. Upload to cloud?</span>
                    <button class="btn-migrate" id="btn-migrate">Upload & Sync</button>
                `;
                appContainer.querySelector('main').prepend(banner);
                document.getElementById('btn-migrate').addEventListener('click', executeMigration);
            }
        }
    }

    async function executeMigration() {
        const btn = document.getElementById('btn-migrate');
        btn.textContent = 'Uploading...';
        btn.disabled = true;

        try {
            const localData = JSON.parse(localStorage.getItem(STORAGE_KEY));

            // Transform for DB (snake_case)
            const rows = localData.map(item => ({
                user_id: currentUser.id,
                opus: item.opus,
                number: item.number,
                title_ja: item.titleJa,
                title_en: item.titleEn,
                genre: item.genre,
                year: item.year,
                rating: item.rating,
                comment: item.comment,
                youtube_urls: item.youtubeUrls,
                created_at: item.createdAt || new Date().toISOString()
            }));

            const { error } = await supabase.from('chopin_library').insert(rows);
            if (error) throw error;

            alert('Migration Successful! Local data has been moved to the cloud.');
            localStorage.removeItem(STORAGE_KEY); // Clear local
            document.getElementById('migration-banner').remove();
            await fetchLibrary(); // Refresh

        } catch (err) {
            console.error(err);
            alert('Migration Failed: ' + err.message);
            btn.textContent = 'Try Again';
            btn.disabled = false;
        }
    }

    // --- Database Functions ---

    async function fetchLibrary() {
        if (!currentUser) return;

        // Fetch from Supabase
        const { data, error } = await supabase
            .from('chopin_library')
            .select('*'); // RLS ensures only user's data

        if (error) {
            console.error('Fetch error:', error);
            return;
        }

        // Map back to app format (camelCase)
        library = data.map(row => ({
            id: row.id,
            userId: row.user_id, // Added for ownership check
            opus: row.opus,
            number: row.number,
            titleJa: row.title_ja,
            titleEn: row.title_en,
            genre: row.genre,
            year: row.year,
            rating: row.rating,
            comment: row.comment,
            youtubeUrls: row.youtube_urls || [],
            createdAt: row.created_at
        }));

        renderLibrary();
    }

    async function saveSong() {
        const op = opusSelect.value;
        const no = noSelect.value;
        const comment = document.getElementById('comment').value.trim();

        if (!op || !no) {
            alert('Opus and No. are required.');
            return;
        }

        const work = window.chopinWorks.find(w => w.op === op && w.no === no);
        if (!work) return;

        // Collect YouTube URLs
        const youtubeInputs = document.querySelectorAll('input[name="youtube[]"]');
        const youtubeUrls = Array.from(youtubeInputs).map(i => i.value.trim()).filter(u => u !== '');

        // Rating
        const ratingInput = document.querySelector('input[name="rating"]:checked');
        const rating = ratingInput ? parseFloat(ratingInput.value) : 0;

        const songData = {
            user_id: currentUser.id,
            opus: op,
            number: no,
            title_ja: work.titleJa,
            title_en: work.titleEn,
            genre: work.genre,
            year: work.year,
            rating: rating,
            comment: comment,
            youtube_urls: youtubeUrls
        };

        if (editingId) {
            // Update
            const { error } = await supabase
                .from('chopin_library')
                .update(songData)
                .eq('id', editingId); // RLS protects this

            if (error) { alert('Error updating: ' + error.message); return; }
        } else {
            // Insert
            const { error } = await supabase
                .from('chopin_library')
                .insert([songData]);

            if (error) { alert('Error adding: ' + error.message); return; }
        }

        resetForm();
        await fetchLibrary(); // Refresh from server
    }

    window.deleteSongInternal = async function (id) {
        if (!confirm('削除してよろしいですか？')) return;

        const { error } = await supabase
            .from('chopin_library')
            .delete()
            .eq('id', id);

        if (error) {
            alert('Delete failed: ' + error.message);
            return;
        }

        if (editingId === id) resetForm();
        await fetchLibrary();
    };

    // --- UI Helpers (Same as before) ---
    function initGenreFilter() {
        const filterSelect = document.getElementById('genre-filter');
        if (!filterSelect || !window.chopinWorks) return;
        const genres = [...new Set(window.chopinWorks.map(w => w.genre))].sort();
        genres.forEach(g => {
            const option = document.createElement('option');
            option.value = g; option.textContent = g; filterSelect.appendChild(option);
        });
    }

    function initOpusDropdown() {
        if (!window.chopinWorks) return;
        const opuses = [...new Set(window.chopinWorks.map(w => w.op))].sort((a, b) => parseFloat(a) - parseFloat(b));
        opuses.forEach(op => {
            const option = document.createElement('option');
            option.value = op; option.textContent = `Op.${op}`; opusSelect.appendChild(option);
        });
    }

    function handleOpusChange() {
        const selectedOp = opusSelect.value;
        noSelect.innerHTML = '<option value="" disabled selected>Select No.</option>';
        noSelect.disabled = true;
        titleInput.value = ''; genreInput.value = ''; yearInput.value = '';

        if (!selectedOp) return;
        const works = window.chopinWorks.filter(w => w.op === selectedOp);
        if (works.length > 0) {
            works.sort((a, b) => parseInt(a.no) - parseInt(b.no));
            if (works.length === 1) {
                const work = works[0];
                const option = document.createElement('option');
                option.value = work.no; option.textContent = '-'; noSelect.appendChild(option);
                noSelect.value = work.no; noSelect.disabled = true; noSelect.classList.add('readonly-input');
            } else {
                works.forEach(work => {
                    const option = document.createElement('option');
                    option.value = work.no; option.textContent = `No.${work.no}`; noSelect.appendChild(option);
                });
                noSelect.selectedIndex = 0; noSelect.disabled = false;
            }
            handleNoChange();
        }
    }

    function handleNoChange() {
        const selectedOp = opusSelect.value;
        const selectedNo = noSelect.value;
        if (!selectedOp || !selectedNo) return;
        const work = window.chopinWorks.find(w => w.op === selectedOp && w.no === selectedNo);
        if (work) {
            titleInput.value = `${work.titleJa} (${work.titleEn})`;
            genreInput.value = work.genre;
            yearInput.value = work.year;
        }
    }

    function addYoutubeInput(value = '') {
        const div = document.createElement('div');
        div.className = 'youtube-input-row';
        div.innerHTML = `<input type="url" name="youtube[]" placeholder="https://www.youtube.com/watch?v=..." value="${value}">`;
        youtubeContainer.appendChild(div);
    }

    function editSong(id) {
        const song = library.find(s => s.id === id);
        if (!song) return;
        editingId = id;
        songForm.scrollIntoView({ behavior: 'smooth' });
        submitBtn.classList.add('editing');
        submitBtn.querySelector('span').textContent = '更新する';
        cancelBtn.classList.add('active');

        opusSelect.value = song.opus;
        handleOpusChange();
        noSelect.value = song.number;
        if (noSelect.options.length <= 1) noSelect.disabled = true;
        handleNoChange();

        const ratingRadio = document.querySelector(`input[name="rating"][value="${song.rating}"]`);
        if (ratingRadio) ratingRadio.checked = true;

        document.getElementById('comment').value = song.comment;

        youtubeContainer.innerHTML = '<label>YouTube URLs <button type="button" id="add-youtube-btn-edit" class="btn-icon-small"><i class="fa-solid fa-plus"></i></button></label>';
        document.getElementById('add-youtube-btn-edit').addEventListener('click', () => addYoutubeInput(''));
        if (song.youtubeUrls && song.youtubeUrls.length > 0) {
            song.youtubeUrls.forEach(url => addYoutubeInput(url));
        } else {
            addYoutubeInput('');
        }
    }

    function resetForm() {
        songForm.reset();
        editingId = null;
        submitBtn.classList.remove('editing');
        submitBtn.querySelector('span').textContent = '登録する';
        cancelBtn.classList.remove('active');
        noSelect.innerHTML = '<option value="" disabled selected>Select No.</option>';
        noSelect.disabled = true;
        youtubeContainer.innerHTML = '<label>YouTube URLs <button type="button" id="add-youtube-btn" class="btn-icon-small"><i class="fa-solid fa-plus"></i></button></label>';
        document.getElementById('add-youtube-btn').addEventListener('click', () => addYoutubeInput(''));
        addYoutubeInput('');
    }

    function renderLibrary() {
        let displayList = library.filter(song => {
            if (genreFilter && song.genre !== genreFilter) return false;
            return true;
        });

        const { key, direction } = sortConfig;
        displayList.sort((a, b) => {
            let valA, valB;
            if (key === 'rating') { valA = a.rating; valB = b.rating; }
            else { valA = parseFloat(a.opus); valB = parseFloat(b.opus); }
            let comparison = 0;
            if (valA > valB) comparison = 1; if (valA < valB) comparison = -1;
            if (direction === 'desc') comparison *= -1;
            if (comparison === 0) {
                if (key !== 'op') {
                    const opA = parseFloat(a.opus); const opB = parseFloat(b.opus);
                    if (opA !== opB) return opA - opB;
                }
                const noA = parseInt(a.number); const noB = parseInt(b.number);
                return noA - noB;
            }
            return comparison;
        });

        document.querySelectorAll('.song-table th').forEach(th => {
            th.classList.remove('sorted-asc', 'sorted-desc');
            if (th.dataset.sort === key) th.classList.add(`sorted-${direction}`);
        });

        songListBody.innerHTML = '';
        if (displayList.length === 0) {
            if (library.length > 0) {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td colspan="8" class="empty-state">条件に一致する曲はありません。</td>`;
                songListBody.appendChild(tr);
                document.querySelector('.song-table').style.display = 'table';
                emptyState.style.display = 'none';
                return;
            }
            emptyState.style.display = 'block';
            document.querySelector('.song-table').style.display = 'none';
            return;
        } else {
            emptyState.style.display = 'none';
            document.querySelector('.song-table').style.display = 'table';
        }

        // Mobile Comment Toggle Logic
        window.toggleComment = function (btn) {
            // New Logic: ID based (data-comment-id)
            const id = btn.dataset.commentId;
            const content = document.getElementById(id);

            // Toggle Icon and Display
            if (content.style.display === 'none' || content.style.display === '') {
                content.style.display = 'block';
                // Active Style (Solid Blue)
                btn.style.background = '#4f83b0';
                btn.style.color = '#fff';
                btn.style.borderColor = '#4f83b0';
            } else {
                content.style.display = 'none';
                // Inactive Style (White)
                btn.style.background = 'white';
                btn.style.color = '#4f83b0';
                btn.style.borderColor = '#eee';
            }
        };

        displayList.forEach(song => {
            const tr = document.createElement('tr');

            const stars = generateStars(song.rating);
            const linksHtml = generateLinksHtml(song.youtubeUrls);

            // Smart Number Logic
            let displayNo = `No.${song.number}`;
            // Check works definition
            if (window.chopinWorks) {
                const worksInOp = window.chopinWorks.filter(w => w.op === song.opus);
                if (worksInOp.length === 1) {
                    displayNo = '-';
                }
            }
            // Ownership Check
            const isOwner = (currentUser && song.userId === currentUser.id);

            // Mobile Footer: [Comment Icon (Left)] [Edit/Delete (Right - Owner Only)]
            const mobileFooterHtml = `
            <!-- Mobile Footer (Renamed to break cache) -->
            <div class="mobile-card-footer mobile-only" style="width: 100% !important; margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px;">
                
                <!-- Left: Comment Toggle -->
                <div class="mobile-footer-left" style="flex: 1;">
                    ${song.comment ? `
                    <button class="comment-toggle-btn" data-comment-id="comment-${song.id}" onclick="toggleComment(this)" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; border: 1px solid #eee; background: white; color: #4f83b0;">
                        <i class="fa-regular fa-comment-dots"></i>
                    </button>
                    ` : '<span style="font-size:0.8rem; color:#ccc;">No Comment</span>'}
                </div>

                <!-- Right: Edit/Delete Buttons (Forced Horizontal) - Owner Only -->
                <div class="mobile-footer-right" style="">
                    ${isOwner ? `
                    <button class="btn-icon-row btn-edit-row-mobile" data-id="${song.id}" style="padding: 8px 12px;">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon-row btn-delete-row-mobile" data-id="${song.id}" style="padding: 8px 12px;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                    ` : '<span style="font-size:0.8rem; color:#aaa;">view only</span>'}
                </div>
            </div>

            <!-- Comment Box (Renamed & Hidden by default) -->
            <div id="comment-${song.id}" class="mobile-comment-box" style="display:none !important; margin-top: 10px; background: #f8fbff; padding: 10px; border-radius: 8px; border: 1px solid #eee; font-size: 0.8rem; color: #444;">
                ${escapeHtml(song.comment)}
            </div>
            `;

            tr.innerHTML = `
                <td class="col-op">Op.${song.opus}</td>
                <td class="col-no">${displayNo}</td>
                <td class="col-genre">${escapeHtml(song.genre)}</td>
                <td class="col-title">
                    <span class="song-title-main">${escapeHtml(song.titleJa)}</span>
                    <span class="song-title-sub">${escapeHtml(song.titleEn)}</span>
                </td>
                <td class="col-rating">${stars}</td>
                <td class="col-links">${linksHtml}</td>
                
                <!-- Desktop Columns -->
                <td class="col-comment desktop-only mobile-hide-force">${escapeHtml(song.comment || '')}</td>
                <td class="col-action desktop-only mobile-hide-force">
                    ${isOwner ? `
                    <button class="btn-icon-row btn-edit-row" data-id="${song.id}">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon-row btn-delete-row" data-id="${song.id}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                    ` : '<span style="color:#aaa; font-size:0.8rem;">View Only</span>'}
                </td>
                
                <!-- Mobile Only Container -->
                <td class="col-mobile-wrapper mobile-only">
                    ${mobileFooterHtml}
                </td>
            `;
            songListBody.appendChild(tr);
        });

        // Attach Event Listeners (Desktop & Mobile)

        // Delete
        const deleteHandler = (e) => deleteSongInternal(e.currentTarget.dataset.id);
        document.querySelectorAll('.btn-delete-row').forEach(btn => btn.addEventListener('click', deleteHandler));
        document.querySelectorAll('.btn-delete-row-mobile').forEach(btn => btn.addEventListener('click', deleteHandler));

        // Edit
        const editHandler = (e) => editSong(e.currentTarget.dataset.id);
        document.querySelectorAll('.btn-edit-row').forEach(btn => btn.addEventListener('click', editHandler));
        document.querySelectorAll('.btn-edit-row-mobile').forEach(btn => btn.addEventListener('click', editHandler));
    }
    // Expose helpers globally for onclick handlers
    window.editSong = editSong;

    function generateStars(rating) {
        let html = '';
        for (let i = 1; i <= 5; i++) {
            if (rating >= i) html += '<i class="fa-solid fa-star"></i>';
            else if (rating === i - 0.5) html += '<i class="fa-solid fa-star-half-stroke"></i>';
            else html += '<i class="fa-regular fa-star" style="color:#ddd"></i>';
        }
        return html;
    }

    function generateLinksHtml(urls) {
        if (!urls || urls.length === 0) return '<span style="color:#555">-</span>';
        let html = '<div class="yt-links-wrapper">';
        urls.forEach(url => {
            const videoId = getYoutubeId(url);
            if (videoId) {
                const thumbUrl = `https://img.youtube.com/vi/${videoId}/default.jpg`;
                html += `<a href="${url}" target="_blank" class="yt-thumbnail-link" style="background-image: url('${thumbUrl}')"><span class="yt-icon-overlay"><i class="fa-brands fa-youtube"></i></span></a>`;
            } else {
                html += `<a href="${url}" target="_blank"><i class="fa-solid fa-link"></i></a>`;
            }
        });
        html += '</div>';
        return html;
    }

    function getYoutubeId(url) {
        if (!url) return null;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    function escapeHtml(text) {
        if (!text) return '';
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
});
