# Driver ↔ passenger communication

Each trip has its own chat, in-app voice and video calls, and phone calls on the numbers people registered with DROP.

## Who can use it, and when

- Only the passenger and the driver on that trip.
- It opens when a driver accepts the trip and closes `COMMS_WINDOW_HOURS` (default 2) after the trip ends, so a lost item can still be sorted out. Cancelled trips close it straight away.
- Support and admin staff can read a trip's chat when handling a report. Each time they do, an entry is written to the audit log. The chat screen tells users this.

## Chat

- Messages appear instantly through a live connection (Server-Sent Events at `/api/comms/stream`). They show "Sent" and then "Read".
- Each side gets quick replies: "I've arrived", "On my way", "Where are you?" and others.
- If the other person isn't in the app, they get a DROP notification instead (at most one every 5 minutes per trip).
- Each user can send up to 20 messages a minute; each message is limited to 1,000 characters.

## In-app voice and video calls

- Calls are browser-to-browser (WebRTC), so no phone number is used or shown. The DROP server only passes the call setup between the two people.
- The call screen shows: ringing, answer or decline, mute, camera on or off, and a call timer.
- An unanswered call stops ringing after 40 seconds. It then shows as a missed call, and the person called gets a notification.
- A short call record ("Video call · 2:14", "Missed voice call") appears in the chat.
- Calls need https, which Railway provides.

**TURN server (recommended before launch).** Free STUN servers connect most calls. On some mobile networks a call only connects through a TURN relay. Options:
- Run coturn on a small VM and set `TURN_URLS=turn:turn.example.com:3478` and `TURN_SECRET`.
- Or use a hosted TURN service (Twilio Network Traversal, Metered, Cloudflare Calls) and set `TURN_USERNAME` and `TURN_CREDENTIAL`.

## Phone calls on registered numbers

Set with `PHONE_CALLS`:

| Mode | What happens | Numbers visible? |
|---|---|---|
| `masked` (needs Twilio) | DROP rings the caller's registered number, then connects them to the other person's registered number. | No. Both sides see the DROP number. |
| `direct` (default without Twilio) | The phone's dialler opens with the other person's registered number. | Yes, but only while the trip is open. |
| `off` | No phone button. Chat and in-app calls still work. | No |

**Setting up masked calling**
1. Create a Twilio account.
2. Buy a South African number (a regulatory bundle is required for SA numbers).
3. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER`.

No webhook is needed. Calls are capped at `PHONE_CALL_MAX_SECONDS`. Local numbers such as `082 123 4567` are converted to `+27821234567`.

## Try it in the demo

The demo passenger (Lerato) and demo driver (Thabo) have a trip in progress with a short conversation. To try it:
1. Open the site in two browsers, or one normal and one private window.
2. Pick **Passenger** in one and **Driver** in the other.
3. Open My trips → Track as the passenger, and Ride requests as the driver.
4. Send messages, then start a voice or video call.

If a visitor completes or cancels the demo trip, a fresh one is created at the next demo sign-in.

## Scaling note

The live connection hub is in memory, which suits the single Railway service. To run more than one API instance, replace `emit()` in `backend/src/comms/hub.js` with Redis pub/sub.
