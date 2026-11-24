# OpenBoard: the cut

Legend.
- One line per ticket: `NN  title   ← deps`. Numbers run across the whole project in construction order; a ticket depends only on lower numbers.
- Ticket files exist for M0-M8 (`.veebee/tickets/NN-slug.md`); from M9 on, these lines are the plan and files are written when the milestone before is nearly done.
- `[c]` marks a line that claims upstream conformance checks, `[s]` one that records `expectedSkips`; every one of the 91 checks is placed exactly once.
- `writes` exclude generated files and the shared append points of `docs/project.md` section 5; tickets touching `contract`, `ports` or migrations are also serialized at claim time.

## M0 Foundations (35)

01  Run verify on a fresh workspace   ← -
02  Print a table of zeros from bun run conformance   ← 01
03  Refuse a conformance pin that differs from the contract's protocol version   ← 02
04  Refuse a conformance run that loses a recorded check   ← 02
05  Print bench counters with bun run bench --quick   ← 02
06  Refuse an import between workspaces the graph forbids   ← 05
07  Refuse a package manifest that disagrees with its imports   ← 06
08  Refuse an integration name in packages or apps   ← 07
09  Refuse a relative import into another workspace   ← 08
10  Refuse an import of a login provider from outside its registry   ← 09
11  Refuse timers, the clock or randomness in contract, core, ports or server   ← 01
12  Refuse console output outside the two output files   ← 11
13  Refuse environment reads outside the config modules   ← 12
14  Refuse module-level mutable state   ← 13
15  Refuse a function over 80 lines   ← 14
16  Refuse a source file over 400 lines or a test over 600   ← 06
17  Refuse a directory of more than 15 source files   ← 16
18  Refuse an AGENTS.md over its byte budget   ← 16
19  Refuse a PR over 600 changed lines in one workspace   ← 18
20  See one required check, Verify, on every pull request   ← 04, 19
21  Open a PR that carries the template's lines   ← 01
22  Route guarded files to the owner for review   ← 01   (dropped: no CODEOWNERS, D44)
23  Mirror ticket files as GitHub issues   ← 01
24  Refuse a ticket claim whose writes overlap a claimed ticket   ← 23
25  Refuse a driver import outside a composition root   ← 10
26  Refuse driver-sql outside the two drivers   ← 25
27  Refuse a database client outside its own driver   ← 26
28  Refuse SQL outside the driver workspaces   ← 27
29  Refuse a migration number that is taken or not newer than main's   ← 19
30  Refuse an edit to an applied migration   ← 29
31  Refuse a destructive migration without the contract-phase marker   ← 30
32  Refuse a registered statement that filters on no tenant   ← 01
33  Run the tenant isolation suite over the contract   ← 01
34  Run the Postgres suites with bun run verify:pg   ← 31
35  Run the Postgres jobs in Verify   ← 20, 34

## M1 Walking skeleton (31)

36  Post a first message on a local board   ← 32, 33, 34
37  Keep the local owner token in a file only I can read   ← 36
38  Refuse a request that carries no credential   ← 37
39  Keep messages across a restart   ← 36
40  Discover a board at its URL [c]   ← 39
41  Reach the local board at bare /api   ← 40
42  Answer JSON 404 for an unknown API path   ← 36
43  See who I am   ← 38
44  Read a thread by its ID   ← 36
45  Reply in a thread [c]   ← 40, 43, 44
46  Reply to a reply in the root's thread [c]   ← 45
47  Read a channel on from a cursor [c]   ← 46
48  Read a channel's newest messages [c]   ← 47
49  Refuse a cursor the board cannot read   ← 48
50  Answer 404 for a message that does not exist [c]   ← 44
51  Answer an invalid request with a way out [c]   ← 36
52  List the board's channels   ← 36
53  List who has written on the board [c]   ← 43, 49, 52
54  Record a newly passing conformance check   ← 04, 37, 40
55  Record the local bench baseline   ← 05, 48
56  Fail the bench when a counter rises   ← 55
57  Fail the bench when a measured value passes its budget   ← 56
58  Print one JSON log line per request   ← 36
59  Keep secrets or message text out of the logs   ← 37, 58
60  Echo a request ID on every answer   ← 38, 59
61  Exit with code 2 on invalid configuration   ← 40
62  Refuse a secret set twice   ← 61
63  Fetch the OpenAPI description   ← 40
64  Refuse a stale generated file   ← 63
65  Refuse a migration that does not render to SQLite   ← 31, 39
66  Refuse store access outside the scoped views   ← 28, 36

## M2 Messages and threads (27)

67  Read back your own post by its client ID   ← 53
68  Post once for a client ID [c]   ← 67
69  Keep noSync on a message [c]   ← 68
70  Refuse a reply after a message that is no longer the newest [c]   ← 69
71  Edit a message   ← 70
72  Delete a message, leaving a tombstone [c]   ← 71
73  Refuse an edit or a delete at a stale revision [c]   ← 72
74  React to a message   ← 73
75  Remove my reaction   ← 74
76  Post a message with labels   ← 75
77  Label a message [c]   ← 76
78  Remove a label   ← 77
79  Refuse a label write whose condition no longer holds [c]   ← 78
80  Mention someone by handle [c]   ← 53, 79
81  List a channel's threads with reply counts   ← 47, 50
82  Find threads by label [c]   ← 76, 81
83  Drop a deleted message from what its labels find [c]   ← 80, 82
84  Read a thread's replies after one of its messages [c]   ← 82
85  Page back through a channel's threads [c]   ← 84
86  Refuse paging both ways at once [c]   ← 85
87  Search threads by text [c]   ← 71, 86
88  List the threads of every channel under a pattern [c]   ← 87
89  Find threads by author   ← 88
90  Find threads that mention someone   ← 80, 89
91  Page through channels under a prefix [c]   ← 52
92  Create a channel   ← 91
93  Answer created: false for a channel that already exists [c]   ← 51, 92

## M3 Live tail (15)

94  Read the feed after a cursor   ← 36
95  Filter the feed like a thread list [c]   ← 90, 94
96  Read a channel's newest events [c]   ← 95
97  Hold a long-poll open until the next event [c]   ← 96
98  Show bookkeeping events with all   ← 53, 97
99  Stream the feed over SSE   ← 98
100  Resume a stream from Last-Event-ID   ← 99
101  Keep a quiet stream open with pings   ← 100
102  End a stream before the platform's time limit   ← 101
103  Follow the feed from the SDK   ← 99
104  Keep an SDK tail going across a server restart   ← 103
105  Tail a channel from the terminal   ← 104
106  Wait for the next event on a thread   ← 97
107  Exit 1 when a wait times out   ← 106
108  Measure 50 SSE tails in the local bench   ← 57, 99

## M4 Accounts, organizations and auth (54)

109  Create a connection on the board   ← 38, 43
110  Post with a connection's secret   ← 109
111  Run conformance as a direct connection   ← 54, 110
112  Write as a named profile   ← 110
113  Give a profile an avatar from its header [c]   ← 112
114  Refuse a malformed x-board-profile   ← 113
115  Ignore the identity headers upstream retired [c]   ← 97, 114
116  Let a profile change only its own messages [c]   ← 83, 112
117  Claim an agent token with a connection secret   ← 112
118  Connect an agent from the terminal   ← 117
119  Refuse a claimed token writing as another profile   ← 117
120  Keep a claimed token inside its pinned can   ← 119
121  Refuse a claimed token on configuration routes   ← 120
122  Refresh a claimed token   ← 121
123  Refuse an expired claimed token   ← 122
124  Spend a single-use secret on its first claim   ← 123
125  Refuse a claim for a profile a live agent holds   ← 124
126  Return the same agent for a repeated claim key   ← 125
127  Refuse a non-direct secret as a bearer   ← 117
128  Revoke a connection   ← 126
129  Revoke one agent of a connection   ← 128
130  Rotate a connection's secret with an overlap   ← 127, 129
131  List the connections I manage   ← 130
132  Read the board's audit events   ← 98, 131
133  Sign in with GitHub in the browser   ← 62, 117
134  Create an organization   ← 133
135  Run the isolation suites across two organizations   ← 134
136  Refuse a reserved organization slug   ← 134
137  Refuse a taken organization slug   ← 136
138  Refuse a second organization for a person   ← 137
139  Refuse a cookie write without the CSRF proof   ← 134
140  Sign out   ← 139
141  Sign out everywhere   ← 140
142  Refuse a session idle for seven days   ← 141
143  Invite someone by link   ← 134
144  Accept an invitation   ← 143
145  Refuse an invitation for a person who already has an organization   ← 138, 144
146  Revoke an invitation   ← 145
147  Refuse an invitation already used or expired   ← 146
148  Bind an invitation to a verified email   ← 147
149  Change a member's role   ← 144
150  Keep at least one owner   ← 149
151  Remove a member   ← 150
152  Cap a member's board permissions by role   ← 109, 144
153  Create a board in an organization   ← 134
154  Refuse a connection secret at another board's URL   ← 130, 153
155  Answer not-found to a member of another organization   ← 41, 135, 144
156  Sign in from the terminal   ← 118, 134, 142
157  Choose the board the CLI talks to   ← 153, 156
158  See my whole context in whoami   ← 157
159  Revoke a personal token   ← 156
160  Refuse a personal token at another organization's URL   ← 155, 159
161  Read the organization's audit events   ← 132, 143, 149
402  Hold every caller to its can on every operation   ← 120, 152

## M5 Postgres driver (14)

162  Post a message on Postgres through OPENBOARD_DATABASE_URL   ← 35, 135
163  Pass the store testkit on Postgres   ← 162
164  Serialize a board's writes with its row lock   ← 163
165  EXPLAIN every registered statement on both engines   ← 163
166  Compare both engines' schemas   ← 163
167  Migrate once under an advisory lock with openboard migrate   ← 162
168  Pass the HTTP and isolation suites on Postgres   ← 163, 165, 166
169  Create an organization on a hosted instance   ← 167, 168
170  Reach the local conformance score on Postgres   ← 164, 168, 169
171  Refuse a hosted score shorter than the local one   ← 170
172  Answer 503 unavailable while the database is unreachable   ← 164
173  Record the hosted bench baseline   ← 170, 172
174  Count database round trips per write   ← 173
175  Measure what row-level security costs   ← 173

## M6 High availability (17)

176  Wake a tail on one instance from a write on another   ← 166, 170, 174
177  Run the HTTP suites on two instances   ← 176
178  Deliver within the safety poll when a notification is lost   ← 176
179  Catch up by cursor after the database restarts   ← 176, 178
180  Survive the kill-the-database drill without losing a write   ← 172, 177, 179
181  Run each due job on exactly one instance   ← 177, 180
182  Drop a revoked credential on every instance at once   ← 177
183  Drain an instance on SIGTERM with a resumable cursor   ← 177, 181
184  Answer the health or readiness probes   ← 177, 183
185  Advance a board's head after a database timeline change   ← 164, 176
186  Run conformance on two instances behind a round-robin proxy   ← 177, 181
187  Build one openboard binary for both modes   ← 186
188  Build the image from the binary   ← 183, 187
189  Deploy staging on Railway with two replicas   ← 120, 123, 402, 167, 184, 188
190  Deploy every merge to staging   ← 189
191  Prove a rolling deploy loses nothing with rolling-check   ← 183, 190
192  Run the nightly checks against staging   ← 190

## M7 Hosted deploy (23)

193  Release to production after staging is healthy   ← 191
194  Publish binaries with each release   ← 193
195  Gate sign-up with OPENBOARD_SIGNUP   ← 169, 177, 182
196  Refuse a resource past its organization's count quota   ← 170, 195
197  Refuse a write past the organization's stored bytes   ← 185, 196
198  Refuse events past a board's daily cap   ← 197
199  Rate-limit writes per organization   ← 181, 184, 188, 196
200  Rate-limit failed authentication per IP   ← 199
201  Rate-limit claims per connection across instances   ← 199
202  Rate-limit token refreshes per agent   ← 201
203  Rate-limit organization creation per person or IP   ← 201
204  Rate-limit invitations per organization   ← 201
205  Rate-limit sign-in attempts per IP   ← 195, 199
206  Cap open streams per principal or organization   ← 102, 183, 199
207  Soft-delete an organization   ← 155, 170, 203
208  Hard-delete an organization 30 days after its deletion   ← 181, 207
209  Soft-delete a board   ← 208
210  Ship each organization's log to the bucket every 10 seconds   ← 199, 208
211  Take a daily pg_dump   ← 210
212  Snapshot a local board with VACUUM INTO on schedule   ← 39, 184
213  Pass the local score from a self-host container on one volume   ← 188, 192, 199, 211, 212
214  Record operator access in the tenant's audit   ← 161, 196, 209, 210
215  Serve a board on production   ← 193, 195, 196, 199, 208

## M8 Front (22)

216  Serve the front from the binary outside /api   ← 187, 199
217  Serve the front with strict security headers   ← 216
218  Sign in from /signin   ← 216
219  Create my organization on /new after signing up   ← 218
220  Join an organization from an invitation link   ← 195, 218
221  Approve a terminal sign-in on /device   ← 218
222  See a board's channels with their latest threads   ← 216
223  See how to post in an empty channel   ← 222
224  Open a thread   ← 222
225  Render message Markdown safely   ← 224
226  Show generic avatars at /avatars/:name   ← 216
227  See a new message arrive live   ← 102, 224
228  Post a new thread from the page   ← 222
229  Reply from the page   ← 224, 228
230  Scroll a long channel smoothly   ← 223
231  Show the page as reconnecting during a deploy   ← 227
232  Invite a member from organization settings   ← 220
233  Create a board from organization settings   ← 216
234  Create a connection from board settings   ← 216
235  Revoke a connection from board settings   ← 234
236  Revoke my sessions on /account   ← 218
237  Run the onboarding journeys in Playwright on both modes   ← 192, 219, 220, 227, 228, 234

## M9 Tasks (38)

238  Start a thread as a task   ← 215
239  List a channel's tasks   ← 238
240  Make a task of a thread that was there [c]   ← 239
241  Make a task once for a client ID [c]   ← 240
242  Claim a task   ← 238
243  Complete a claimed task [c]   ← 242
244  Renew a claim's lease [c]   ← 243
245  Return an unrenewed task to the queue   ← 244
246  Claim on one instance a task whose lease ran out on another   ← 177, 245
247  Release a claim   ← 244
248  Fail a task   ← 247
249  Refuse a write by a lost claim [c]   ← 248
250  Cancel a task   ← 249
251  Reopen a failed task   ← 250
252  Hold a task until what it needs completes [c]   ← 251
253  Refuse a canceled prerequisite [c]   ← 252
254  Say task.ready when a waiting task becomes ready [c]   ← 253
255  List the tasks that wait for one [c]   ← 254
256  List the last active tasks [c]   ← 255
257  Change what a task needs [c]   ← 256
258  Refuse needs that make a task wait for itself [c]   ← 257
259  Refuse a change of needs on a held or finished task [c]   ← 258
260  Make several tasks in one write [c]   ← 259
261  Make none of a batch when one task fails [c]   ← 260
262  Hold a task for a person   ← 249
263  Lift a hold on a task [c]   ← 262
264  Assign a task to a profile [c]   ← 263
265  Claim the next ready task in a channel   ← 264
266  Claim the next ready task with a label   ← 265
267  Wait for a ready task to claim [c]   ← 266
268  Claim the next ready task of other owners   ← 267
269  Follow a feed of tasks becoming ready [c]   ← 267
270  Refuse a label under board. [c]   ← 238
271  Cancel a task when its root is deleted   ← 250
272  Hold a task when someone else edits its root   ← 262
273  See a channel's tasks in the front   ← 222, 239
274  Measure 500 task cycles in the bench   ← 243
275  Mirror ready tickets as board tasks   ← 267

## M10 Access (24)

276  Grant a principal on a board   ← 215
277  List a board's grants   ← 276
278  Revoke a grant [c]   ← 277
279  Change a grant by its ID [c]   ← 278
280  Keep a grant's can as written [c]   ← 279
281  Explain what a caller may do on a channel [c]   ← 280
282  Let everyone's grant narrow what others let in [c]   ← 281
283  Take manage to change grants [c]   ← 282
284  Refuse a grant that would lock its maker out [c]   ← 283
285  Make several grants in one write [c]   ← 284
286  Narrow a request with x-board-can [c]   ← 281
287  Refuse a malformed x-board-can   ← 286
288  Keep a narrowed caller from granting past its can [c]   ← 283, 286
289  Keep a narrowed caller from opening more than it has [c]   ← 288
290  Refuse a claim by a caller without label [c]   ← 267, 286
291  Refuse a prerequisite a narrowed caller cannot read [c]   ← 261, 286
292  Let a profile change only the tasks it made [c]   ← 264, 286
293  Record upstream's four permanent grant skips [s]   ← 285
294  Create a private channel only its grant opens   ← 283
295  Explain a connection's access   ← 281
296  Post from GitHub Actions with no secret   ← 276
297  Accept a grant naming another OIDC issuer   ← 296
298  Narrow a personal token   ← 286
299  Edit grants in board settings   ← 216, 279

## M11 Webhooks and watchers (39)

300  Ack a registered watcher's match [c]   ← 215
301  Answer 501 to a wake-by-path registration [c]   ← 300
302  Refuse a narrowed caller's watchers [c]   ← 286, 300
303  Fail a match after five tries   ← 300
304  Deliver a signed board event to a webhook   ← 181
305  Refuse a private or loopback webhook URL   ← 304
306  Send a test ping to a webhook   ← 304
307  Retry a failed delivery with backoff   ← 304
308  Dead-letter a delivery after its last attempt   ← 307
309  Re-send a dead delivery   ← 308
310  Disable a subscription answered 410   ← 307
311  Disable a subscription after 100 dead deliveries in a day   ← 308
312  Sign deliveries with the github preset   ← 304
313  Sign deliveries with the stripe preset   ← 312
314  Sign deliveries with the ts-id-body preset   ← 313
315  Sign deliveries with a custom scheme   ← 314
316  Send static headers with no signature   ← 304
317  Shape a delivery's body with a template   ← 304
318  Refuse a template with an unknown path   ← 317
319  Fire only when a task becomes ready   ← 254, 304
320  Deliver one thread's events in order   ← 307
321  Skip events the creator can no longer read   ← 281, 304
322  Deliver each event exactly once across two instances   ← 320
323  Encrypt signing secrets at rest   ← 304
324  Cap deliveries per organization   ← 304
325  Refuse webhook configuration to a claimed token   ← 304
326  Create an inbound endpoint   ← 181
327  Refuse an inbound event with a bad signature   ← 326
328  Reply in a thread from an inbound rule   ← 327
329  Label a thread from an inbound rule   ← 328
330  Hold, release or cancel a task from an inbound rule   ← 263, 328
331  End a claim early from an inbound rule   ← 245, 328
332  Revoke an agent from an inbound rule   ← 328
333  Answer a repeated inbound event with its first result   ← 328
334  Answer 422 when no thread matches an inbound event   ← 328
335  Refuse an inbound rule that does not parse   ← 326
336  List what an inbound endpoint received   ← 333
337  Manage webhooks in board settings   ← 216, 304
338  Verify deliveries in examples/webhook-receiver   ← 304

## M12 MCP, SDK, skill (22)

339  List the board's tools over MCP   ← 215
340  Answer 405 to GET on the MCP endpoint   ← 339
341  Read a channel over MCP   ← 339
342  Post over MCP   ← 341
343  Reply over MCP   ← 342
344  Claim the next task over MCP   ← 267, 343
345  Complete a task over MCP   ← 344
346  Wait for events over MCP   ← 341
347  Connect the SDK with a secret   ← 215
348  Publish the SDK to npm   ← 194, 347
349  Publish the client-only CLI to npm   ← 348
350  Generate the skill's command reference   ← 215
351  Install the skill with npx skills add   ← 350
352  Onboard an agent read-only first through the skill   ← 351
353  Serve a proxy policy for injecting gateways   ← 215
354  Run a sandboxed agent with no long-lived secret in its VM   ← 349, 353
355  Launch an agent from a ready task through a remote routine   ← 319, 354
356  Link the agent's run in its thread   ← 355
357  Leave a note when a turn ends without settling the task   ← 328, 355
358  Return the task when a run fails or expires   ← 331, 332, 355
359  Wake the run when a person replies   ← 355
360  Complete a task on production with only the skill   ← 345, 349, 352

## M13 Data, files, schedules (21)

361  List the built-in schemas [c]   ← 215
362  Register a schema version once [c]   ← 361
363  Refuse a built-in's name or an uncheckable definition [c]   ← 362
364  Check a message's block against its schema [c]   ← 362
365  Refuse schema registration by a narrowed caller [c]   ← 286, 362
366  Show a block as fields in the front   ← 224, 364
367  Attach a file to a message [c]   ← 215
368  Refuse a file name that would download as a dotfile [c]   ← 367
369  Start a task with a file [c]   ← 238, 367
370  Answer 501 to direct uploads   ← 367
371  Store attachments in Postgres   ← 367
372  Delete files that were never attached   ← 181, 367
373  Schedule a reply   ← 215
374  List a thread's schedules   ← 373
375  Cancel a schedule [c]   ← 374
376  Keep noSync on a schedule [c]   ← 375
377  Repeat a schedule every interval   ← 373
378  Send a schedule on time from any instance   ← 181, 373
379  Send an overdue schedule once after downtime   ← 378
380  Let a profile cancel only its own schedules   ← 375
381  Trigger a webhook from a recurring schedule   ← 304, 377

## M14 External sync (6)

382  Answer sync routes as a board that syncs nowhere   ← 215
383  Refuse a sync target on a post   ← 382
384  Refuse a sync entry in a watcher registration   ← 300, 382
385  Record the sync checks as expected skips while sync is deferred [s]   ← 272, 384
386  Build sync's records, inbox, receipts   ← 385
387  Run a platform bridge recipe against staging   ← 304, 386

## M15 Operations (14)

388  Ship a local board's log to a bucket   ← 212
389  Restore a local board with openboard restore   ← 388
390  Restore a hosted organization from its backups   ← 210, 211
391  Record a restore drill in both modes   ← 389, 390
392  Export an organization   ← 210
393  Import an organization export into ob serve   ← 392
394  Serve operator metrics at /api/x/metrics   ← 215
395  Sweep expired operational rows   ← 181
396  Roll up daily usage per organization   ← 181
397  Rebuild a board's folds with openboard reproject   ← 215
398  Apply the event-log compaction policy   ← 397
399  Run openboard admin commands   ← 215
400  Upgrade a deployment by the runbook   ← 193
401  Hold the full bench within budgets for seven nightly runs   ← 192, 274

## Could not place

### Questions only the owner can answer

1. **Accounts in M4 local mode.** M4 must pass in local mode, but local mode has "no sign-up" (`docs/architecture.md` modes table; `docs/codebase.md` 5.5: without `OPENBOARD_DATABASE_URL`, one implicit organization). `docs/auth.md` "Local mode" says sign-in providers work there "if configured". Tickets 133-161 assume `ob serve` honours `OPENBOARD_SIGNUP=open` with GitHub configured and lets people create organizations. Confirm, or say where these tickets get checked before M5.
2. **Surfaces before the front.** After GitHub sign-in, the flow goes to SPA pages (`/new`, `/<org>/main`), and device approval happens on `/device`. Both arrive in M8. In M4, tickets 134, 156 and their neighbours check through the documented `/api/x/…` routes with the session cookie and `x-ob-csrf`. Confirm that this is acceptable.
3. **Which command lists a channel's messages** (`GET /messages`) once `ob read <channel>` lists threads like upstream's `vb read` (ticket 81)? Tickets 36 and 47 use `ob read dev` for messages.
4. **Codes the docs do not give.** Refusing an invitation to someone with the wrong verified email (148), and refusing to demote the last owner (150).
5. **Enforcement mechanisms the docs do not name:**
   - module-level mutable state (14);
   - environment reads (13);
   - "Store only in `app.ts` and `scope.ts`" (66): placed as a `boundaries.ts` rule, to be confirmed.
6. **Files most tickets touch that are not shared append points:**
   - `packages/driver-sql/src/statements.ts`: the self-check treats it like an append point;
   - `tools/conformance/score.json`, `openapi.json` and the skill's `commands.md`: rewritten by `--update` or `gen`, so left out of `writes`;
   - `packages/contract/src/errors.ts`: landed whole in 36 (upstream codes) and 109 (OpenBoard codes) so later tickets do not compete for it.
7. **M14.** Should it build sync's records, inbox and receipts (386), or only record `expectedSkips`? D19 and Q8 defer sync, while `docs/project.md` M14 lists "Sync records, inbox, receipts".
8. **M15 lines without a design.** The event-log compaction policy (398), and the `openboard admin` command set (399), which no doc lists.
9. **Usage rollups (396).** `docs/codebase.md` 4.5 says "rollups after v1"; `docs/architecture.md` "SaaS seams" says "Rollup job running" is a v1 must.
10. **Open product questions Q1-Q8** in `docs/decisions.md`:
    - sandbox credential path;
    - backup bucket;
    - stated availability;
    - email provider;
    - OAuth for MCP;
    - open or invite-only sign-up;
    - immutable slugs;
    - sync in v1.
11. **Dogfooding.** Phase A (organization `tvc` on production, from M7) is setup work, not a code ticket. Phase B is 275 (`scripts/tickets/sync-board.ts`).
12. **M7 and M8 choices the docs leave open** (written into their tickets as proposals):
    - how a local-mode container listens (213): proposed `OPENBOARD_HOST`, set to `0.0.0.0` by the image;
    - the first operator action and its command (214): proposed `openboard admin quota <org> <key>=<n> --reason …`, recorded as `ob.operator.*` organization events;
    - which forwarding header carries the client IP behind Railway's edge (199), to check on staging;
    - the set of generic avatar names (226);
    - how many local snapshots to keep (212): proposed eight;
    - deleting the board `main` (209): proposed refused, `main` goes only with its organization;
    - how an invite-only instance gets its first person (215): proposed one sign-up while `OPENBOARD_SIGNUP=open`.
13. **M3 is not upstream of M5-M8.** No dependency path leads from the live-tail tickets (94-108) to M5 onward, although 177, 183, 206, 227 and 231 build on SSE. 206 and 227 now depend on 102; 177 and 183 were left as written.

### Contradictions between docs (decisions.md followed where it speaks)

- **Core check count.** `docs/protocol.md` "Conformance groups" says core has 30 checks. Upstream's `src/conformance/index.ts` and `docs/project.md` say 29. The cut uses 29.
- **Build order.** `docs/protocol.md` puts `x-board-can` narrowing in "core identity" (step 4) and events in step 2. `docs/project.md` puts narrowing in M10 (286) and events in M3. The cut follows `docs/project.md`.
- **When the isolation suite starts.** `docs/architecture.md` "SaaS seams" says "in CI from the first hosted milestone". `docs/codebase.md` 6.5 and `docs/project.md` M4 say from the first multi-tenant ticket. The cut follows M4 (135).
- **Bench failure threshold.** `docs/architecture.md` says a budget missed by more than 20% fails. `docs/codebase.md` 6.6 says exact counters, and any measured value over its budget fails (57).
- **Org view signature.** `docs/data-model.md` and `docs/architecture.md` write `store.org(orgId)`. `docs/codebase.md` writes `store.org(scope)`, with only the resolver minting scopes (D33).
- **Default sign-up mode.** `docs/auth.md` says hosted defaults to `open`. Q6 recommends `invite`, and `docs/project.md` M7 ships behind `OPENBOARD_SIGNUP=invite`.
- **Local owner principal.** `docs/auth.md` gives it as `ob:user:local-<os user>`, while `users.public_id` is `u_<base32>` (`docs/data-model.md`).
- **Numbering.** `docs/codebase.md` 3.3 numbers its points 1, 2, 3, 5, 4.
- **Rate limits in hosted mode.** `docs/codebase.md` 4.5 says the hosted implementation is "never an in-memory counter". `docs/auth.md` "Rate limits" and `docs/architecture.md` "SaaS seams" keep per-instance token buckets for hot paths and Postgres counters only for the limits marked †. The cut follows the latter (199, 201).
