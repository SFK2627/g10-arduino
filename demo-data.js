window.G10_DEMO = {
  profile: {
    uid: "demo-student",
    studentId: "2026-10001",
    fullName: "JUAN DELA CRUZ",
    section: "GRADE 10 - DEMO SECTION",
    role: "student",
    active: true
  },

  settings: {
    schoolYear: "2026-2027",
    currentTerm: 1,
    latestLessonTitle: "Introduction to Arduino",
    latestActivityTitle: "Mini PETA 3 - Emergency Lights",
    announcement: "Welcome to the Grade 10 Arduino learning hub."
  },

  lessons: [
    {
      id: "demo-lesson-1",
      title: "Introduction to Arduino",
      description: "Arduino Uno, basic parts, and how a simple circuit works.",
      term: 1,
      order: 1,
      fileId: "",
      fileName: "Introduction-to-Arduino.pdf",
      fileType: "application/pdf",
      fileSize: 2400000,
      published: true,
      allowedSections: ["GRADE 10 - DEMO SECTION"]
    },
    {
      id: "demo-lesson-2",
      title: "Digital Output and LEDs",
      description: "Using digital pins, resistors, LEDs, HIGH, LOW, and delay().",
      term: 1,
      order: 2,
      fileId: "",
      fileName: "Digital-Output-and-LEDs.pdf",
      fileType: "application/pdf",
      fileSize: 1700000,
      published: true,
      allowedSections: ["GRADE 10 - DEMO SECTION"]
    }
  ],

  activities: [
    {
      id: "demo-activity-1",
      title: "Mini PETA 3 - Emergency Lights",
      description: "Build a two-color red and blue emergency-light sequence using Arduino.",
      term: 1,
      order: 1,
      dueDate: "2026-08-21",
      fileId: "",
      fileName: "Mini-PETA-3-Emergency-Lights.pdf",
      fileType: "application/pdf",
      published: true,
      allowedSections: ["GRADE 10 - DEMO SECTION"]
    }
  ],

  compliance: {
    term: 1,
    // Sample numbers shown ONLY in local Demo Mode (not a real student's data).
    termGrade: 89,
    gradeStatus: "available",
    gradeType: "recorded",
    gradeSource: "AW",
    lastUpdated: "2026-08-14T20:35:00+08:00",
    tasks: [
      { taskId: "ww1", category: "ww", categoryLabel: "Written Work",
        displayName: "Arduino Concepts Quiz", status: "Completed", missing: false,
        percentageBand: "orange" },
      { taskId: "ww2", category: "ww", categoryLabel: "Written Work",
        displayName: "Circuit Diagram Exercise", status: "Missing", missing: true,
        percentageBand: "black" },
      { taskId: "pt1", category: "pt", categoryLabel: "Performance Task",
        displayName: "Mini PETA - Emergency Lights", status: "Completed", missing: false,
        score: 18, maxScore: 20, scorePercent: 90, percentageBand: "lime" },
      { taskId: "pt2", category: "pt", categoryLabel: "Performance Task",
        displayName: "Arduino Array Activity", status: "Completed", missing: false,
        score: 38, maxScore: 40, scorePercent: 95, percentageBand: "green" },
      { taskId: "ta1", category: "ta", categoryLabel: "Term Assessment",
        displayName: "Midterm Examination", status: "Completed", missing: false,
        score: 42, maxScore: 50, scorePercent: 84, percentageBand: "yellow" }
    ],
    summary: { complete: 4, missing: 1, total: 5 }
  }
};
