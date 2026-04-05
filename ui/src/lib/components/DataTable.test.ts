import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import DataTable from "./DataTable.svelte";

describe("DataTable", () => {
    const columns = [
        { key: "name", label: "Name" },
        { key: "status", label: "Status" },
    ];

    const data = [
        { id: 1, name: "Alpha", status: "Active" },
        { id: 2, name: "Beta", status: "Inactive" },
    ];

    it("renders column headers", () => {
        render(DataTable, { props: { columns, data, keyField: "id" } });
        expect(screen.getByText("Name")).toBeTruthy();
        expect(screen.getByText("Status")).toBeTruthy();
    });

    it("renders row data in default cell mode", () => {
        render(DataTable, { props: { columns, data, keyField: "id" } });
        expect(screen.getByText("Alpha")).toBeTruthy();
        expect(screen.getByText("Beta")).toBeTruthy();
        expect(screen.getByText("Active")).toBeTruthy();
        expect(screen.getByText("Inactive")).toBeTruthy();
    });

    it("shows default empty message when no data", () => {
        render(DataTable, { props: { columns, data: [], keyField: "id" } });
        expect(screen.getByText("No data available")).toBeTruthy();
    });

    it("calls onRowClick when a row is clicked", async () => {
        const onRowClick = vi.fn();
        render(DataTable, {
            props: { columns, data, keyField: "id", onRowClick },
        });
        await fireEvent.click(screen.getByText("Alpha"));
        expect(onRowClick).toHaveBeenCalledWith(
            expect.objectContaining({ id: 1, name: "Alpha" }),
        );
    });

    it("supports sortable columns", async () => {
        const onSort = vi.fn();
        const sortableColumns = [
            { key: "name", label: "Name", sortable: true },
            { key: "status", label: "Status" },
        ];
        render(DataTable, {
            props: {
                columns: sortableColumns,
                data,
                keyField: "id",
                onSort,
            },
        });
        await fireEvent.click(screen.getByText("Name"));
        expect(onSort).toHaveBeenCalledWith({ key: "name", direction: "asc" });
    });

    it("toggles sort direction on second click", async () => {
        const onSort = vi.fn();
        const sortableColumns = [
            { key: "name", label: "Name", sortable: true },
        ];
        render(DataTable, {
            props: {
                columns: sortableColumns,
                data,
                keyField: "id",
                sortKey: "name",
                sortDirection: "asc",
                onSort,
            },
        });
        await fireEvent.click(screen.getByText("Name"));
        expect(onSort).toHaveBeenCalledWith({ key: "name", direction: "desc" });
    });

    it("renders a table element", () => {
        render(DataTable, { props: { columns, data, keyField: "id" } });
        expect(screen.getByRole("table")).toBeTruthy();
    });
});
