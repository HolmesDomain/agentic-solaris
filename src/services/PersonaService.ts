/**
 * PersonaService - Manages persona data for survey completion
 */

import fs from "fs";
import path from "path";
import { config } from "../config/env.js";

interface Persona {
    [key: string]: any;
}

export class PersonaService {
    private persona: Persona;

    constructor() {
        this.persona = this.loadPersona();
    }

    private loadPersona(): Persona {
        const personaPath = path.join(process.cwd(), "personas", `${config.PERSONA}.json`);

        try {
            if (fs.existsSync(personaPath)) {
                const data = fs.readFileSync(personaPath, "utf-8");
                console.log(`👤 Loaded persona: ${config.PERSONA}`);
                return JSON.parse(data);
            }
        } catch (e) {
            console.warn(`⚠️ Could not load persona ${config.PERSONA}:`, e);
        }

        // Return default persona
        console.log("👤 Using default persona");
        return {
            age: 25,
            gender: "Male",
            occupation: "Software Developer",
            location: "United States",
            education: "Bachelor's Degree",
        };
    }

    getPersona(): Persona {
        return this.persona;
    }

    getFormattedPersona(): string {
        const lines: string[] = [];

        const formatValue = (key: string, value: any, prefix = ""): void => {
            if (value === null || value === undefined) return;

            if (typeof value === "object" && !Array.isArray(value)) {
                for (const [k, v] of Object.entries(value)) {
                    formatValue(k, v, `${prefix}${key} `);
                }
            } else if (Array.isArray(value)) {
                lines.push(`${prefix}${key}: ${value.join("; ")}`);
            } else {
                lines.push(`${prefix}${key}: ${value}`);
            }
        };

        for (const [key, value] of Object.entries(this.persona)) {
            formatValue(key, value);
        }

        return lines.join("\n");
    }

    getValue(key: string): any {
        return this.persona[key];
    }
}
