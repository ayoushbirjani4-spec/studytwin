// The parent link: one student's report, read-only. The key is in the part
// of the link after #, which browsers don't send to servers; it is posted to
// the API in the request body.
(async () => {
  const status = document.getElementById("parentStatus");
  const token = new URLSearchParams(location.hash.slice(1)).get("k");
  if (!token) {
    status.textContent = "This link is incomplete. Ask the teacher to send it again.";
    return;
  }
  try {
    const response = await fetch("/api/parent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The report couldn't be loaded.");
    document.title = `${data.student.name} · StudyTwin`;
    document.getElementById("parentReport").innerHTML = studentReportHtml(data.student, data.className);
    status.textContent = "";
    status.classList.add("hidden");
  } catch (error) {
    status.textContent = error.message || "The report couldn't be loaded. Try again later.";
  }
})();
