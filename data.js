/* ==========================================================================
   PCPlayground data layer
   --------------------------------------------------------------------------
   Everything here is plain data so it can later be swapped for a fetch()
   to a real backend (e.g. a Cloudflare Worker hitting D1/KV) without
   touching the calculation engine in app.js — the engine only ever reads
   PCDB.gpus / PCDB.cpus / PCDB.games, however they got populated.

   Scores are relative performance indices (not raw benchmark numbers):
     GPU score  — 3D throughput, RTX 4090 pinned to 100
     CPU score  — single-core-weighted gaming throughput, top chip ~100
   TDP is manufacturer-listed board/package power in watts.
   Game rows: [name, refFpsAt1080pHigh, cpuCeilingFps, ramHeavy]
     refFpsAt1080pHigh / cpuCeilingFps are both measured against the same
     reference rig (RTX 3060 + Ryzen 5 5600 + 16GB) so the engine can scale
     each axis independently and take the lower of the two.
   ========================================================================== */

(function () {
  const GPU_ROWS = [
    // name, score, tdp(W), vram(GB)
    ["RTX 4090", 100, 450, 24], ["RTX 4080 Super", 82, 320, 16], ["RTX 4080", 78, 320, 16],
    ["RTX 4070 Ti Super", 72, 285, 16], ["RTX 4070 Ti", 68, 285, 12], ["RTX 4070 Super", 64, 220, 12],
    ["RTX 4070", 58, 200, 12], ["RTX 4060 Ti 16GB", 46, 165, 16], ["RTX 4060 Ti", 45, 160, 8],
    ["RTX 4060", 38, 115, 8], ["RTX 3090 Ti", 76, 450, 24], ["RTX 3090", 72, 350, 24],
    ["RTX 3080 Ti", 70, 350, 12], ["RTX 3080 12GB", 68, 350, 12], ["RTX 3080", 65, 320, 10],
    ["RTX 3070 Ti", 58, 290, 8], ["RTX 3070", 55, 220, 8], ["RTX 3060 Ti", 48, 200, 8],
    ["RTX 3060", 38, 170, 12], ["RTX 3050", 26, 130, 8], ["RTX 2080 Ti", 52, 250, 11],
    ["RTX 2080 Super", 46, 250, 8], ["RTX 2080", 44, 215, 8], ["RTX 2070 Super", 42, 215, 8],
    ["RTX 2070", 38, 175, 8], ["RTX 2060 Super", 34, 175, 8], ["RTX 2060", 32, 160, 6],
    ["GTX 1660 Ti", 26, 120, 6], ["GTX 1660 Super", 25, 125, 6], ["GTX 1660", 23, 120, 6],
    ["GTX 1650 Super", 18, 100, 4], ["GTX 1650", 14, 75, 4], ["GTX 1080 Ti", 34, 250, 11],
    ["GTX 1080", 28, 180, 8], ["GTX 1070 Ti", 26, 180, 8], ["GTX 1070", 24, 150, 8],
    ["GTX 1060 6GB", 18, 120, 6], ["GTX 1060 3GB", 15, 120, 3], ["GTX 1050 Ti", 10, 75, 4],
    ["RX 7900 XTX", 88, 355, 24], ["RX 7900 XT", 78, 315, 20], ["RX 7900 GRE", 68, 260, 16],
    ["RX 7800 XT", 62, 263, 16], ["RX 7700 XT", 54, 245, 12], ["RX 7600 XT", 40, 190, 16],
    ["RX 7600", 36, 165, 8], ["RX 6950 XT", 68, 335, 16], ["RX 6900 XT", 65, 300, 16],
    ["RX 6800 XT", 62, 300, 16], ["RX 6800", 56, 250, 16], ["RX 6750 XT", 50, 250, 12],
    ["RX 6700 XT", 47, 230, 12], ["RX 6650 XT", 38, 180, 8], ["RX 6600 XT", 36, 160, 8],
    ["RX 6600", 32, 132, 8], ["RX 6500 XT", 18, 107, 4], ["RX 6400", 13, 53, 4],
    ["RX 5700 XT", 40, 225, 8], ["RX 5700", 36, 180, 8], ["RX 5600 XT", 32, 150, 6],
    ["RX 5500 XT", 24, 130, 8], ["RX 590", 20, 175, 8], ["RX 580 8GB", 18, 185, 8],
    ["RX 580 4GB", 16, 185, 4], ["RX 570", 15, 150, 4], ["RX 480", 15, 150, 8],
    ["RX 470", 13, 120, 4], ["Arc A770", 40, 225, 16], ["Arc A750", 36, 225, 8],
    ["Arc A580", 28, 175, 8], ["Arc A380", 15, 75, 6],
  ];

  const CPU_ROWS = [
    // name, score, tdp(W), cores, threads
    ["Ryzen 7 9800X3D", 100, 120, 8, 16], ["Ryzen 9 9950X3D", 98, 170, 16, 32],
    ["Core i9-14900K", 92, 253, 24, 32], ["Ryzen 7 7800X3D", 95, 120, 8, 16],
    ["Core i9-13900K", 90, 253, 24, 32], ["Ryzen 9 7950X3D", 94, 120, 16, 32],
    ["Ryzen 9 7900X", 82, 170, 12, 24], ["Core i7-14700K", 88, 253, 20, 28],
    ["Core i7-13700K", 85, 253, 16, 24], ["Ryzen 7 7700X", 80, 105, 8, 16],
    ["Ryzen 5 7600X", 76, 105, 6, 12], ["Ryzen 5 7600", 74, 65, 6, 12],
    ["Core i5-14600K", 84, 181, 14, 20], ["Core i5-13600K", 82, 181, 14, 20],
    ["Core i5-12600K", 76, 150, 10, 16], ["Ryzen 9 5950X", 75, 105, 16, 32],
    ["Ryzen 9 5900X", 73, 105, 12, 24], ["Ryzen 7 5800X3D", 88, 105, 8, 16],
    ["Ryzen 7 5800X", 68, 105, 8, 16], ["Ryzen 7 5700X", 66, 65, 8, 16],
    ["Ryzen 5 5600X", 64, 65, 6, 12], ["Ryzen 5 5600", 62, 65, 6, 12],
    ["Ryzen 5 5500", 55, 65, 6, 12], ["Core i9-11900K", 68, 125, 8, 16],
    ["Core i7-11700K", 65, 125, 8, 16], ["Core i5-11600K", 60, 125, 6, 12],
    ["Core i5-11400", 54, 65, 6, 12], ["Core i9-10900K", 66, 125, 10, 20],
    ["Core i7-10700K", 62, 125, 8, 16], ["Core i5-10600K", 58, 125, 6, 12],
    ["Core i5-10400", 48, 65, 6, 12], ["Ryzen 9 3900X", 58, 105, 12, 24],
    ["Ryzen 7 3800X", 56, 105, 8, 16], ["Ryzen 7 3700X", 54, 65, 8, 16],
    ["Ryzen 5 3600X", 50, 95, 6, 12], ["Ryzen 5 3600", 48, 65, 6, 12],
    ["Ryzen 5 2600X", 38, 95, 6, 12], ["Ryzen 5 2600", 36, 65, 6, 12],
    ["Ryzen 5 1600", 32, 65, 6, 12], ["Core i7-9700K", 58, 95, 8, 8],
    ["Core i7-8700K", 56, 95, 6, 12], ["Core i5-9600K", 52, 95, 6, 6],
    ["Core i5-8400", 44, 65, 6, 6], ["Core i7-7700K", 48, 91, 4, 8],
    ["Core i5-7600K", 42, 91, 4, 4], ["Core i3-10100", 38, 65, 4, 8],
    ["Core i3-9100", 30, 65, 4, 4],
  ];

  const GAME_ROWS = [
    // name, refFps@1080pHigh(RTX3060+R5600), cpuCeiling(R5600), ramHeavy(needs 16GB+ to breathe)
    ["Valorant", 240, 400, 0], ["Counter-Strike 2", 180, 350, 0], ["Fortnite", 90, 220, 0],
    ["Rocket League", 200, 400, 0], ["Overwatch 2", 150, 300, 0], ["Apex Legends", 100, 180, 0],
    ["Roblox", 200, 350, 0], ["Minecraft (Vanilla)", 220, 300, 0], ["Minecraft (Shaders)", 55, 140, 0],
    ["League of Legends", 220, 400, 0], ["Dota 2", 150, 280, 0], ["PUBG: Battlegrounds", 75, 150, 1],
    ["Rainbow Six Siege", 160, 300, 0], ["Genshin Impact", 90, 200, 0], ["Among Us", 300, 400, 0],
    ["Fall Guys", 150, 260, 0], ["Terraria", 300, 400, 0], ["Stardew Valley", 300, 400, 0],
    ["Sea of Thieves", 80, 160, 0], ["It Takes Two", 85, 160, 0], ["Cyberpunk 2077", 48, 95, 1],
    ["Red Dead Redemption 2", 52, 100, 1], ["Grand Theft Auto V", 92, 200, 0],
    ["Grand Theft Auto Online", 70, 150, 1], ["Forza Horizon 5", 70, 150, 0],
    ["Assassin's Creed Valhalla", 58, 110, 1], ["Assassin's Creed Mirage", 68, 140, 0],
    ["The Witcher 3 (Next-Gen)", 60, 130, 1], ["Far Cry 6", 65, 140, 0],
    ["Battlefield 2042", 62, 140, 1], ["Call of Duty: Warzone", 55, 130, 1],
    ["Call of Duty: Modern Warfare III", 70, 160, 1], ["Diablo IV", 75, 150, 0],
    ["Destiny 2", 90, 190, 0], ["Star Wars Jedi: Survivor", 45, 90, 1],
    ["The Last of Us Part I", 50, 100, 1], ["Resident Evil 4 (Remake)", 65, 140, 0],
    ["Dying Light 2", 55, 110, 1], ["Halo Infinite", 75, 160, 0], ["Doom Eternal", 130, 250, 0],
    ["Sekiro: Shadows Die Twice", 90, 180, 0], ["Ghost of Tsushima", 65, 130, 0],
    ["God of War", 62, 125, 0], ["Death Stranding", 95, 180, 0], ["Control", 55, 110, 1],
    ["Metro Exodus (Enhanced)", 45, 90, 1], ["Shadow of the Tomb Raider", 70, 150, 0],
    ["Monster Hunter Wilds", 42, 85, 1], ["Palworld", 55, 110, 1], ["Lies of P", 65, 130, 0],
    ["Black Myth: Wukong", 38, 80, 1], ["Elden Ring", 58, 62, 0], ["Baldur's Gate 3", 55, 100, 1],
    ["Hogwarts Legacy", 50, 100, 1], ["Starfield", 48, 90, 1], ["Horizon Forbidden West", 58, 115, 1],
    ["Marvel's Spider-Man 2", 60, 120, 0], ["Alan Wake 2", 40, 80, 1],
    ["Marvel's Spider-Man Remastered", 85, 170, 0], ["EA Sports FC 24", 110, 220, 0],
    ["NBA 2K24", 90, 180, 0], ["Street Fighter 6", 140, 280, 0], ["Tekken 8", 130, 260, 0],
    ["Mortal Kombat 1", 120, 240, 0], ["Escape from Tarkov", 45, 90, 1],
    ["World of Warcraft", 75, 150, 1], ["Final Fantasy XIV", 90, 170, 0], ["Warframe", 110, 220, 0],
    ["Path of Exile 2", 65, 140, 1], ["Helldivers 2", 55, 110, 1],
  ];

  const REF = { gpuScore: 38, cpuScore: 62 }; // RTX 3060 / Ryzen 5 5600

  const gpus = GPU_ROWS.map(([name, score, tdp, vram]) => ({ name, score, tdp, vram, type: "gpu" }))
    .sort((a, b) => b.score - a.score);
  const cpus = CPU_ROWS.map(([name, score, tdp, cores, threads]) => ({ name, score, tdp, cores, threads, type: "cpu" }))
    .sort((a, b) => b.score - a.score);
  const games = GAME_ROWS.map(([name, refFps, cpuCeiling, ramHeavy]) => ({ name, refFps, cpuCeiling, ramHeavy: !!ramHeavy }))
    .sort((a, b) => a.name.localeCompare(b.name));

  window.PCDB = { gpus, cpus, games, REF };
})();
