import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { api } from '@drop/shared';

/**
 * Background GPS: keeps sending the driver's position while they're online, even with the screen off
 * or the app closed (Android foreground service with a visible notification; iOS background location
 * with the blue indicator). Going offline stops it.
 */
export const LOCATION_TASK = 'drop-driver-location';

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const l = (data as { locations?: Location.LocationObject[] }).locations?.at(-1);
  if (!l) return;
  await api('/drivers/location', { body: { lat: l.coords.latitude, lng: l.coords.longitude, heading: l.coords.heading ?? undefined, speed: l.coords.speed ?? undefined, accuracy: l.coords.accuracy ?? undefined } }).catch(() => undefined);
});

export async function startTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) return true;
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 4000,
    distanceInterval: 15,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: { notificationTitle: 'DROP Driver is online', notificationBody: 'Sharing your location with passengers. Go offline to stop.', notificationColor: '#FF6B00', killServiceOnDestroy: false },
  });
  return bg.granted ? true : 'foreground-only';
}

export async function stopTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}
