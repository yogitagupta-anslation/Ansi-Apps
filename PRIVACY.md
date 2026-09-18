# Privacy Policy — App Hub

**Last updated: 18 September 2026**

> **Before publishing:** replace `[COMPANY NAME]`, `[CONTACT EMAIL]` and `[JURISDICTION]`
> below, host this at a public URL, and paste that URL into the Play Console listing.
> Play requires a policy URL for every app. Have a lawyer read it before you rely on it —
> this draft describes what the code actually does, but it is not legal advice.

App Hub is published by [COMPANY NAME] ("we", "us"). This policy covers the App Hub
Android application and every mini-app inside it: BLE Chat, EventPulse, Higher or Lower,
Attendance, Treasure Hunt and Hitch.

## The short version

App Hub does not have a server. It does not collect, transmit or sell your personal
information, and there is no account to create. Everything you enter stays on your phone.
The only data that leaves your device goes directly to another phone nearby over
Bluetooth, and only while you are using a feature that does that.

## What we collect

**Nothing is sent to us.** We operate no servers, no analytics, no advertising SDKs and
no crash-reporting services. We cannot see your messages, your contacts, your profile or
how you use the app, because none of it reaches us.

## What is stored on your device

Depending on which mini-apps you use, App Hub stores the following locally:

- A display name and profile details you choose
- A cryptographic identity key, generated on your device
- Messages you send and receive, and their delivery status
- Attendance records, event profiles, game history and ride history
- A profile photo, if you choose one — downscaled and stored as image data

Message content and queued messages are encrypted at rest with a key generated on your
device. On devices that support it, that key is itself wrapped by a key held in the
Android hardware Keystore, which never leaves the device. Cloud backup is disabled for
this app, so none of this is copied to Google Drive.

You can erase all of it at any time by clearing the app's data or uninstalling the app.
There is no copy anywhere else.

## What is shared over Bluetooth

When you use a feature that finds people nearby, your phone broadcasts a small
advertisement other phones running App Hub can see. Depending on the mini-app, it
contains a short random identifier, the display name you chose, and a few flags such as
which vehicle type you are offering or which interests you selected.

When you message or connect to someone, that content goes directly between the two
phones over Bluetooth. It does not pass through us or any third party.

BLE Chat conversations are end-to-end encrypted between the two devices. Other
mini-apps' Bluetooth traffic is not encrypted and should be treated as visible to
someone with radio equipment in range — do not send anything sensitive through them.

## About the location permission

Android requires apps that scan for Bluetooth devices to hold the location permission,
because Bluetooth scan results can in principle be used to infer location. App Hub
requests `ACCESS_FINE_LOCATION` **only so that Bluetooth scanning works**.

**App Hub never reads your location.** It contains no code that queries GPS, network
location or any location API, it does not request background location, and it does not
store or transmit any location data. Distances shown in the app are estimated from
Bluetooth signal strength — how strong a signal is, not where anyone is.

## Photos

If you set a profile picture, the app opens your system photo picker or camera app. The
image you choose is resized on your device and stored locally. It is not uploaded
anywhere. App Hub does not request access to your photo library beyond the single image
you pick.

## Children

App Hub is not directed at children under 13, and we do not knowingly collect
information from them. Since we collect nothing at all, there is nothing for us to
delete — but a parent or guardian can clear the app's data at any time.

## Permissions, and why each one exists

| Permission | Why |
| --- | --- |
| Bluetooth scan / connect / advertise | Finding and talking to nearby devices — the core of the app |
| Location (fine and coarse) | Required by Android for Bluetooth scanning. Never used for location |
| Foreground service | Keeps a chat or attendance session alive while the screen is off |
| Notifications | Tells you about messages and session status |
| Photos / storage (Android 12 and below) | Choosing a profile picture |
| Internet, network state | Used by the app framework; App Hub makes no network requests of its own |
| Vibrate, audio settings | Haptic feedback and game sound effects |

## Your rights

Because no personal data reaches us, there is no account to access, export or delete,
and no data of yours for us to hand over or correct. Your data lives on your device and
is under your control. Uninstalling the app removes it.

## Changes

If this policy changes we will update the date at the top and post the new version at
the same URL.

## Contact

Questions about this policy: [CONTACT EMAIL]

[COMPANY NAME], [JURISDICTION]
