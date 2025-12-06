// Data is loaded from data.js via script tag (window.chopinWorks)

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
        // ... Same ...
        const filterSelect = document.getElementById('genre-filter');
        if (!filterSelect || !window.chopinWorks) return;
        const genres = [...new Set(window.chopinWorks.map(w => w.genre))].sort();
        genres.forEach(g => {
            const option = document.createElement('option');
            option.value = g; option.textContent = g; filterSelect.appendChild(option);
        });
    }

    function initOpusDropdown() {
        // ... Same ...
        if (!window.chopinWorks) return;
        const opuses = [...new Set(window.chopinWorks.map(w => w.op))].sort((a, b) => parseFloat(a) - parseFloat(b));
        opuses.forEach(op => {
            const option = document.createElement('option');
            option.value = op; option.textContent = `Op. ${op}`; opusSelect.appendChild(option);
        });
    }

    function handleOpusChange() {
        // ... Same Logic ...
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

        displayList.forEach(song => {
            const tr = document.createElement('tr');
            const stars = generateStars(song.rating);
            const linksHtml = generateLinksHtml(song.youtubeUrls);
            tr.innerHTML = `
                <td class="col-op">Op.${song.opus}</td>
                <td class="col-no">No.${song.number}</td>
                <td class="col-genre">${escapeHtml(song.genre)}</td>
                <td class="col-title">
                    <span class="song-title-main">${escapeHtml(song.titleJa)}</span>
                    <span class="song-title-sub">${escapeHtml(song.titleEn)}</span>
                </td>
                <td class="col-rating">${stars}</td>
                <td class="col-links">${linksHtml}</td>
                <td class="col-comment">${escapeHtml(song.comment || '')}</td>
                <td class="col-action">
                    <button class="btn-icon-row btn-edit-row" onclick="window.editSong('${song.id}')">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon-row btn-delete-row" onclick="window.deleteSongInternal('${song.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            songListBody.appendChild(tr);
        });
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
// --- Elements ---
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
let library = loadLibrary();

// Sort/Filter State
let sortConfig = {
    key: 'op', // 'op', 'rating'
    direction: 'asc'
};
let genreFilter = '';

// Edit State
let editingId = null;

// --- Initialization ---
initOpusDropdown();
initGenreFilter();
renderLibrary();

// --- Event Listeners ---
addYoutubeBtn.addEventListener('click', () => addYoutubeInput(''));

opusSelect.addEventListener('change', handleOpusChange);
noSelect.addEventListener('change', handleNoChange);

// Genre Filter Listener
document.getElementById('genre-filter').addEventListener('change', (e) => {
    genreFilter = e.target.value;
    renderLibrary();
});

// Stop propagation on filter click to prevent sorting if we had sorting on th (but we removed it)
document.getElementById('genre-filter').addEventListener('click', (e) => {
    e.stopPropagation();
});

songForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (editingId) {
        updateSong();
    } else {
        addSong();
    }
});

cancelBtn.addEventListener('click', resetForm);

// Sorting Headers
tableHeader.addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th || !th.dataset.sort) return;

    const key = th.dataset.sort;
    if (sortConfig.key === key) {
        // Toggle direction
        sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortConfig.key = key;
        sortConfig.direction = 'asc'; // Default new sort is asc
        if (key === 'rating') sortConfig.direction = 'desc';
    }
    renderLibrary();
});

// --- Functions (Logic) ---

function initGenreFilter() {
    const filterSelect = document.getElementById('genre-filter');
    if (!filterSelect || !window.chopinWorks) return;

    const genres = [...new Set(window.chopinWorks.map(w => w.genre))].sort();
    genres.forEach(g => {
        const option = document.createElement('option');
        option.value = g;
        option.textContent = g;
        filterSelect.appendChild(option);
    });
}

function initOpusDropdown() {
    if (!window.chopinWorks) return;
    // Extract unique Opus numbers and sort them
    const opuses = [...new Set(window.chopinWorks.map(w => w.op))].sort((a, b) => {
        // Handle "posth" or non-numeric logic if needed, but chops are mostly numeric
        // Some might contain non-digits, assume parse float
        return parseFloat(a) - parseFloat(b);
    });

    opuses.forEach(op => {
        const option = document.createElement('option');
        option.value = op;
        option.textContent = `Op. ${op}`;
        opusSelect.appendChild(option);
    });
}

function handleOpusChange() {
    const selectedOp = opusSelect.value;
    noSelect.innerHTML = '<option value="" disabled selected>Select No.</option>';
    noSelect.disabled = true;

    // Reset auto-filled fields
    titleInput.value = '';
    genreInput.value = '';
    yearInput.value = '';

    // "Smart Op/No" - if No doesn't exist (only one work and no number explicit in text), we still need to handle it.
    // Actually, logic requested: "If No selection is available... disable if No doesn't exist"
    // But in our data, even single works have "no": "1".
    // Let's check if there are multiple works for this Op.

    if (!selectedOp) return;

    const works = window.chopinWorks.filter(w => w.op === selectedOp);

    if (works.length > 0) {
        // Sort works by No
        works.sort((a, b) => parseInt(a.no) - parseInt(b.no));

        // Check if we should enable No dropdown
        // If works.length > 1, surely enable.
        // If works.length === 1 and it is nominally "1", should we disable?
        // User requirement: "Disable No selection if No doesn't exist".
        // Implementation: Auto-select No.1 and disable dropdown if        if (works.length === 0) return;

        // Populate No Dropdown
        if (works.length === 1) {
            // Single work in Opus (e.g., Op.11, Op.53)
            const work = works[0];
            const option = document.createElement('option');
            option.value = work.no; // Keep value for logic
            option.textContent = '-';   // Display as dash (User Request)
            noSelect.appendChild(option);

            // Auto-select and disable
            noSelect.value = work.no;
            noSelect.disabled = true;
            noSelect.classList.add('readonly-input');
        } else {
            // Multiple works (e.g., Op.10, Op.28)
            // Add a default placeholder if needed, or just list them.
            // User flow: Select Opus -> Select No.
            // Let's add a default "Select No" option so they have to pick? 
            // Or just list them. The original code listed them.
            // Let's stick to listing them.

            works.forEach(work => {
                const option = document.createElement('option');
                option.value = work.no;
                option.textContent = `No.${work.no}`;
                noSelect.appendChild(option);
            });

            // If we want to force user to select No, we might want a placeholder?
            // "No." is usually 1-indexed. work.number is "1", "2".
            // Currently it auto-selects the first one (No.1) because it's first in list.
            // Let's trigger change.
            noSelect.selectedIndex = 0;
            noSelect.disabled = false;
        }
        handleNoChange(); // Trigger fill
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
    div.innerHTML = `
            <input type="url" name="youtube[]" placeholder="https://www.youtube.com/watch?v=..." value="${value}">
        `;
    youtubeContainer.appendChild(div);
}

function loadLibrary() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
}

function saveLibrary() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

function addSong() {
    const songData = collectFormData();
    if (!songData) return;

    library.push(songData); // Push (append) then sort? Or unshift? User said Sort default is Op->No. 
    // We will sort in render, so order in array doesn't matter much.

    saveLibrary();
    renderLibrary();
    resetForm();
}

function updateSong() {
    const songData = collectFormData();
    if (!songData) return;

    // Preserve original creation date and ID
    const index = library.findIndex(s => s.id === editingId);
    if (index !== -1) {
        songData.id = editingId;
        songData.createdAt = library[index].createdAt;
        library[index] = songData;
        saveLibrary();
        renderLibrary();
        resetForm();
    }
}

function collectFormData() {
    const op = opusSelect.value;
    const no = noSelect.value;
    const comment = document.getElementById('comment').value.trim();

    if (!op || !no) {
        alert('Opus and No. are required.');
        return null;
    }

    const work = window.chopinWorks.find(w => w.op === op && w.no === no);
    if (!work) return null;

    // Collect YouTube URLs
    const youtubeInputs = document.querySelectorAll('input[name="youtube[]"]');
    const youtubeUrls = Array.from(youtubeInputs)
        .map(input => input.value.trim())
        .filter(url => url !== '');

    // Rating
    const ratingInput = document.querySelector('input[name="rating"]:checked');
    const rating = ratingInput ? parseFloat(ratingInput.value) : 0;

    return {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        opus: op,
        number: no,
        titleJa: work.titleJa,
        titleEn: work.titleEn,
        genre: work.genre,
        year: work.year,
        rating,
        youtubeUrls,
        comment
    };
}

function editSong(id) {
    const song = library.find(s => s.id === id);
    if (!song) return;

    editingId = id;

    // Scroll to form
    songForm.scrollIntoView({ behavior: 'smooth' });

    // Change Buttons
    submitBtn.classList.add('editing');
    submitBtn.querySelector('span').textContent = '更新する';
    cancelBtn.classList.add('active');

    // Fill Data
    opusSelect.value = song.opus;
    handleOpusChange(); // Triggers generation of No options

    noSelect.value = song.number;
    // Check if handleOpusChange disabled it (smart logic) - we should keep it that way if it matches
    if (noSelect.options.length <= 1) noSelect.disabled = true; // wait, handleOpusChange handles this

    handleNoChange(); // Fills Title/Genre/Year

    // Rating
    const ratingRadio = document.querySelector(`input[name="rating"][value="${song.rating}"]`);
    if (ratingRadio) ratingRadio.checked = true;

    // Comment
    document.getElementById('comment').value = song.comment;

    // YouTube
    youtubeContainer.innerHTML = '<label>YouTube URLs <button type="button" id="add-youtube-btn-edit" class="btn-icon-small"><i class="fa-solid fa-plus"></i></button></label>';
    // Re-attach listener to new button
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

    // Reset YouTube
    youtubeContainer.innerHTML = '<label>YouTube URLs <button type="button" id="add-youtube-btn" class="btn-icon-small"><i class="fa-solid fa-plus"></i></button></label>';
    document.getElementById('add-youtube-btn').addEventListener('click', () => addYoutubeInput(''));
    addYoutubeInput('');
}

function deleteSongInternal(id) {
    if (!confirm('削除してよろしいですか？')) return;
    library = library.filter(song => song.id !== id);
    saveLibrary();
    renderLibrary();
    if (editingId === id) resetForm();
}

function renderLibrary() {
    // --- Filtering ---
    let displayList = library.filter(song => {
        if (genreFilter && song.genre !== genreFilter) return false;
        return true;
    });

    // --- Sorting Logic ---
    const { key, direction } = sortConfig;

    displayList.sort((a, b) => {
        let valA, valB;

        // Primary Sort
        if (key === 'rating') {
            valA = a.rating;
            valB = b.rating;
        } else { // 'op' or default
            // Sort by Op first
            valA = parseFloat(a.opus);
            valB = parseFloat(b.opus);
        }

        let comparison = 0;
        if (valA > valB) comparison = 1;
        if (valA < valB) comparison = -1;

        if (direction === 'desc') comparison *= -1;

        // Tie Breaking (Always Op -> No)
        if (comparison === 0) {
            if (key === 'op') {
                // fallthrough
            } else {
                const opA = parseFloat(a.opus);
                const opB = parseFloat(b.opus);
                if (opA !== opB) return opA - opB;
            }

            const noA = parseInt(a.number);
            const noB = parseInt(b.number);
            return noA - noB;
        }

        return comparison;
    });

    // --- Update Header Icons ---
    document.querySelectorAll('.song-table th').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (th.dataset.sort === key) {
            th.classList.add(`sorted-${direction}`);
        }
    });

    // --- Rendering ---
    songListBody.innerHTML = '';

    if (displayList.length === 0) {
        // If library has items but filter creates empty state
        if (library.length > 0) {
            // Wait, we are targeting tbody.
            // Revert to showing empty row or hiding table?
            // Let's just append a row saying no results
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

    displayList.forEach(song => {
        const tr = document.createElement('tr');

        const stars = generateStars(song.rating);
        const linksHtml = generateLinksHtml(song.youtubeUrls);

        tr.innerHTML = `
                <td class="col-op">Op.${song.opus}</td>
                <td class="col-no">No.${song.number}</td>
                <td class="col-genre">${escapeHtml(song.genre)}</td>
                <td class="col-title">
                    <span class="song-title-main">${escapeHtml(song.titleJa)}</span>
                    <span class="song-title-sub">${escapeHtml(song.titleEn)}</span>
                </td>
                <td class="col-rating">${stars}</td>
                <td class="col-links">${linksHtml}</td>
                <td class="col-comment">${escapeHtml(song.comment || '')}</td>
                <td class="col-action">
                    <button class="btn-icon-row btn-edit-row" data-id="${song.id}">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon-row btn-delete-row" data-id="${song.id}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
        songListBody.appendChild(tr);
    });

    // Attach Event Listeners
    document.querySelectorAll('.btn-delete-row').forEach(btn => {
        btn.addEventListener('click', (e) => deleteSongInternal(e.currentTarget.dataset.id));
    });
    document.querySelectorAll('.btn-edit-row').forEach(btn => {
        btn.addEventListener('click', (e) => editSong(e.currentTarget.dataset.id));
    });
}

// --- Helpers ---

function generateStars(rating) {
    // Advanced 0.5 step star rendering
    let html = '';
    for (let i = 1; i <= 5; i++) {
        if (rating >= i) {
            // Full star
            html += '<i class="fa-solid fa-star"></i>';
        } else if (rating === i - 0.5) {
            // Half star
            html += '<i class="fa-solid fa-star-half-stroke"></i>';
        } else {
            // Empty star
            html += '<i class="fa-regular fa-star" style="color:#ddd"></i>';
        }
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
            html += `
                    <a href="${url}" target="_blank" class="yt-thumbnail-link" style="background-image: url('${thumbUrl}')">
                        <span class="yt-icon-overlay"><i class="fa-brands fa-youtube"></i></span>
                    </a>
                `;
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
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
});
