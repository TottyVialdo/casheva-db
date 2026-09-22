const BASE_URL = 'http://127.0.0.1:3000/api';

async function login(username, password = 'Admin123!') {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': 'casheva-secure-client',
    },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${username}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.accessToken || data.access_token;
}

async function test() {
  console.log('--- Testing Super Admin -> Kotama Monitoring Scope ---');
  let tokenSuper;
  try {
    tokenSuper = await login('superadmin', 'Admin123!');
  } catch (e) {
    tokenSuper = await login('admin', 'Admin123!');
  }

  const fetchWithAuth = async (endpoint, extraHeaders = {}) => {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${tokenSuper}`,
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': 'casheva-secure-client',
        ...extraHeaders,
      },
    });
    if (!res.ok) {
      const txt = await res.text();
      return { status: res.status, error: txt };
    }
    return res.json();
  };

  // 1. Kotama List
  const kotamas = await fetchWithAuth('/master/kotama');
  console.log(`Kotamas found: ${Array.isArray(kotamas) ? kotamas.length : 0}`);

  // CASE 1: Global
  console.log('\n=== CASE 1: Super Admin Global (No Monitoring) ===');
  const globalSummary = await fetchWithAuth('/dashboard/summary');
  const globalAnggota = await fetchWithAuth('/anggota');
  const globalSimpanan = await fetchWithAuth('/simpanan/rekap');
  const globalSatminkal = await fetchWithAuth('/master/satminkal');

  console.log('Dashboard Summary (Global):', {
    totalAnggota: globalSummary.totalAnggota,
    totalSimpanan: globalSummary.totalSimpanan,
    totalPinjaman: globalSummary.totalPinjaman,
  });
  console.log('Anggota List count (Global):', Array.isArray(globalAnggota) ? globalAnggota.length : globalAnggota);
  console.log('Simpanan Rekap count (Global):', Array.isArray(globalSimpanan) ? globalSimpanan.length : globalSimpanan);
  console.log('Satminkal List count (Global):', Array.isArray(globalSatminkal) ? globalSatminkal.length : globalSatminkal);

  // CASE 2: Super Admin Monitoring Kotama (KODAM IV)
  const targetKotama = Array.isArray(kotamas)
    ? (kotamas.find((k) => k.kode === '07' || k.nama.includes('DIPONEGORO')) || kotamas[0])
    : null;

  if (targetKotama) {
    console.log(`\n=== CASE 2: Super Admin Monitoring Kotama: [${targetKotama.kode}] ${targetKotama.nama} ===`);
    const kotamaHeaders = { 'kotama-id': targetKotama.id };

    const kotamaSummary = await fetchWithAuth('/dashboard/summary', kotamaHeaders);
    const kotamaAnggota = await fetchWithAuth('/anggota', kotamaHeaders);
    const kotamaSimpanan = await fetchWithAuth('/simpanan/rekap', kotamaHeaders);
    const kotamaSatminkals = await fetchWithAuth('/master/satminkal', kotamaHeaders);

    console.log('Dashboard Summary (Kotama Monitored):', {
      totalAnggota: kotamaSummary.totalAnggota,
      totalSimpanan: kotamaSummary.totalSimpanan,
      totalPinjaman: kotamaSummary.totalPinjaman,
    });
    console.log('Anggota List count (Kotama Monitored):', Array.isArray(kotamaAnggota) ? kotamaAnggota.length : kotamaAnggota);
    console.log('Simpanan Rekap count (Kotama Monitored):', Array.isArray(kotamaSimpanan) ? kotamaSimpanan.length : kotamaSimpanan);
    console.log('Satminkal List count (Kotama Monitored):', Array.isArray(kotamaSatminkals) ? kotamaSatminkals.length : kotamaSatminkals);

    // CASE 3: Super Admin Monitoring Specific Satminkal under that Kotama (e.g. INFOLAHTADAM)
    if (Array.isArray(kotamaSatminkals) && kotamaSatminkals.length > 0) {
      const targetSat = kotamaSatminkals[0];
      console.log(`\n=== CASE 3: Super Admin Monitoring Satminkal inside Kotama: [${targetSat.kode}] ${targetSat.nama} ===`);
      const satHeaders = {
        'kotama-id': targetKotama.id,
        'satminkal-id': targetSat.id,
      };

      const satSummary = await fetchWithAuth('/dashboard/summary', satHeaders);
      const satAnggota = await fetchWithAuth('/anggota', satHeaders);
      const satSimpanan = await fetchWithAuth('/simpanan/rekap', satHeaders);

      console.log('Dashboard Summary (Satminkal Monitored):', {
        totalAnggota: satSummary.totalAnggota,
        totalSimpanan: satSummary.totalSimpanan,
        totalPinjaman: satSummary.totalPinjaman,
      });
      console.log('Anggota List count (Satminkal Monitored):', Array.isArray(satAnggota) ? satAnggota.length : satAnggota);
      console.log('Simpanan Rekap count (Satminkal Monitored):', Array.isArray(satSimpanan) ? satSimpanan.length : satSimpanan);
    }
  }
}

test().catch(console.error);
