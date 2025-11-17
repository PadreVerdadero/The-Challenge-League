// ... (full app.js code from your current version)

// Add this near the top of your script (after let processingExpiry = false;)
let sweepRecordedFor = null; // prevents double-writing champion board

// Then update your checkForSweep() function like this:
async function checkForSweep(triggerContext = 'unknown') {
  try {
    const normalizedOrder = playersOrderArr.map(norm).filter(id => id != null);
    const visibleIds = normalizedOrder.filter(id => id !== norm(championId) && players[id]);
    const defeatedArray = Array.from(defeated).map(norm);

    console.log('[checkForSweep] triggered by:', triggerContext);
    console.log('[checkForSweep] championId:', norm(championId));
    console.log('[checkForSweep] playersOrderArr:', normalizedOrder);
    console.log('[checkForSweep] visibleIds (non-champion):', visibleIds);
    console.log('[checkForSweep] defeated set:', defeatedArray);

    const allDefeated = visibleIds.length > 0 && visibleIds.every(id => defeated.has(id));
    if (allDefeated) {
      if (championId && championId !== sweepRecordedFor) {
        console.log('[checkForSweep] sweep detected — recording champion:', championId);
        if (players[championId]) {
          await addChampionBoardEntry(championId, players[championId].name);
        } else {
          await addChampionBoardEntry(championId, String(championId));
        }
        sweepRecordedFor = championId;
      } else {
        console.log('[checkForSweep] sweep already recorded for', championId);
      }

      await setTimerEnd(null);
      isPendingState = true;
      playExplosionAnimation(10000);
      log('All challengers defeated — new group challenge pending');
      updateTimerDisplay();
    } else {
      console.log('[checkForSweep] no sweep (allDefeated=false)');
      sweepRecordedFor = null; // reset lock if sweep no longer active
    }
    return allDefeated;
  } catch (e) {
    console.error('checkForSweep error', e);
    return false;
  }
}
