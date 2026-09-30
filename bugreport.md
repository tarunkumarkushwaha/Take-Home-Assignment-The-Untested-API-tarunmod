Bugs

1. Pagination skips the first page.
Where: in file taskservice.js line no 11
Problem: The offset treats page as 0-based, but the route defaults to page 1 and the API is documented as 1-based. Page 1 therefore starts at item limit.
Its effect: ?page=0 was the only way to reach the true first page, and the route's parseInt(page) || 1 turned 0 into 1. With any pagination param present, the first items were unreachable.
Fix: offset = (page - 1) * limit.
status: fixed

2. The status filter does substring matching.

Where: in file taskservice.js line no 9, t.status.includes(status).
Its effect: String.prototype.includes is a substring test, so ?status=do matches done. The route also never validated status, so garbage values returned [] instead of an error.
status: pending

3. Completing a task resets its priority.

Where: in file taskservice.js line no 69, the object literal contains priority: 'medium'.
Its effect: It looks like a leftover or a mistaken side effect. Nothing about completing a task implies changing its priority, and a high-priority task silently becoming medium loses data.
Fix: Remove that line.
status: fixed

4. Completing twice overwrites completedAt.

Where: in file taskservice.js line no 9 completeTask, which has no check for an already-done task.
Its effect: Every call stamps a fresh new Date(), so the original completion time is lost.
status: pending

5. status and page/limit can't be combined.

Where: routes/tasks.js, GET /, where the if (status) { return res.json(...) } returns before the pagination branch is reached.
Its effect: Filtering and pagination were written as separate code paths instead of one pipeline. With ?status=todo&page=2, the page value was ignored, and the sample request in your brief hits exactly this.
status: pending

6. Bad page/limit values are accepted.

Where: routes/tasks.js, GET /, parseInt(page) || 1 and parseInt(limit) || 10.
Its effect: parseInt is lenient and || default swallows every falsy result. abc, 0 and NaN silently become defaults, 10abc becomes 10, and -1 passes straight through. There is also no upper bound on limit.
status: pending

7. PUT can overwrite protected fields.

Where: in file taskservice.js line no 46 update, { ...tasks[index], ...fields }.
Its effect: The raw request body is spread over the stored task, so a client can send {"id": "x", "createdAt": ...} and change them (mass assignment). An array body passes update validation and gets spread in as well.
status: pending

8. completedAt gets out of sync with status.

Where: in file taskservice.js line no 46 update and line no 3 create.
Its effect: Only completeTask set completedAt. PUT {status: "done"} left it null, reopening a done task left the old timestamp, and creating a task as done gave it none.
status: pending

9. Malformed JSON returns 500.

Where: app.js, the error middleware.
Its effect: express.json() raises a parse error tagged as a client error (err.type === 'entity.parse.failed'), but the handler ignores that and always sends 500. Separately, unknown routes fell through to Express's default HTML 404.
status: pending
