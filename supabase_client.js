const SUPABASE_URL = 'https://krvivxlfcgwlsppxyzpa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtydml2eGxmY2d3bHNwcHh5enBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwMzA3MjQsImV4cCI6MjA4MDYwNjcyNH0.3lMtP5cy1vNUWjdYfTaY6gvsVUEFZNnH63L42spAGJA';

if (typeof window.supabase !== 'undefined') {
    const { createClient } = window.supabase;
    // Store in a unique global property to avoid shadowing the SDK factory
    window.chopinSupabase = createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
    console.error('Supabase SDK not loaded! Check your script tags.');
}

// Check connection helper
async function checkConnection() {
    if (!supabase) return false;
    try {
        const { data, error } = await supabase.from('chopin_library').select('count', { count: 'exact', head: true });
        if (error) throw error;
        console.log('Supabase Connected!');
        return true;
    } catch (err) {
        console.error('Supabase Connection Error:', err);
        return false;
    }
}
