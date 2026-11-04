PRS — offline version
=====================

The whole app on this PC, for when it can't reach the server. Work as usual;
when you're connected to the server again, sync, and your changes go to the
server and everyone else's come here.

Starting it
-----------
Unzip this folder anywhere you can write to (your Documents, say) and start
PRS.exe. A window says "PRS is running at http://127.0.0.1:8765" and your
browser opens the app. Keep that window open while you use it; close it to
stop the app. Nothing is installed and no admin rights are needed.

The first time
--------------
While you're connected to the server: the app asks for the server's address
(e.g. https://prs.app) and your username and password there, and fetches a copy
of everything. Then sign in as you do on the server.

Working offline
---------------
Everything works as on the server — Emitters, Modes, versions, Platforms,
MDFs, dwells, tests, intercepts — except the AI features and the backups
page. Others can't see what you do until you sync.

Syncing
-------
Back on the server's network, open "Sync" in the top bar:
  1. Sign in to the server.
  2. "Check against the server" shows what syncing would do. If something was
     changed both here and on the server since you fetched the copy, you see
     both values and choose which to keep — per Emitter, Platform, MDF ...
  3. "Sync". Your changes go in, and this PC fetches the server's copy, so it
     has everyone's changes. Versions you saved here keep their place in the
     history (renumbered after the server's if the server saved one too).

Where your data is
------------------
%LOCALAPPDATA%\PRS — the database, and in "before-replace" a copy of what was
on this PC each time it was replaced by the server's. Deleting that folder
resets the app to its first start.

The app on the PC must be the same version as the server's to sync; if not,
it says so — get the matching version.
