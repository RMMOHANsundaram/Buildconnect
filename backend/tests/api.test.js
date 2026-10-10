const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");

describe("API Endpoints", () => {
  afterAll(async () => {
    // Close mongoose connection after tests
    await mongoose.connection.close();
  });

  it("should return 200 on /api healthcheck", async () => {
    const res = await request(app).get("/api");
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty("message");
    expect(res.body.message).toBe("BuildConnect Backend is Running");
  });

  it("should fetch services on /api/services", async () => {
    const res = await request(app).get("/api/services");
    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("should fetch packages on /api/packages", async () => {
    const res = await request(app).get("/api/packages");
    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
