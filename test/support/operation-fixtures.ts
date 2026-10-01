import type { OrderItem, Tab, TabSummary, WorkflowStage } from '../../app/lib/operation'
import type { MenuProduct } from '../../app/lib/order-builder'

export const UNIT = '0192f000-0000-7000-8000-0000000000f1'
export const SHIFT = '0192f000-0000-7000-8000-0000000000e1'
export const COUNTER = '0192f000-0000-7000-8000-0000000000c1'
export const KITCHEN = '0192f000-0000-7000-8000-0000000000a1'
export const DELIVERY = '0192f000-0000-7000-8000-0000000000a2'

/** Template padrão (spec 03, seção 4.4): Recebido → Preparando → Pronto → Entregue. */
export const stages: WorkflowStage[] = [
  {
    id: 's1',
    name: 'Recebido',
    sortOrder: 1,
    target: 'product_station',
    stationId: null,
    isFinal: false,
  },
  {
    id: 's2',
    name: 'Preparando',
    sortOrder: 2,
    target: 'product_station',
    stationId: null,
    isFinal: false,
  },
  {
    id: 's3',
    name: 'Pronto',
    sortOrder: 3,
    target: 'fixed_station',
    stationId: DELIVERY,
    isFinal: false,
  },
  { id: 's4', name: 'Entregue', sortOrder: 4, target: 'none', stationId: null, isFinal: true },
]

export function item(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'i1',
    orderId: 'o1',
    tabId: 't1',
    unitId: UNIT,
    tabNumber: 12,
    customerName: 'Dona Marta',
    orderNumberInTab: 1,
    productId: 'p1',
    productName: 'Espeto de carne',
    unitPriceCents: 1200,
    quantity: 3,
    note: null,
    modifiers: [],
    totalCents: 3600,
    prepStationId: KITCHEN,
    stationId: KITCHEN,
    stageId: 's1',
    stageName: 'Recebido',
    stageIsFinal: false,
    stageEnteredAt: '2026-10-01T20:00:00.000Z',
    sentAt: '2026-10-01T20:00:00.000Z',
    lateAt: '2026-10-01T20:15:00.000Z',
    isLate: false,
    canceledAt: null,
    canceledBy: null,
    cancelReason: null,
    wasted: false,
    splitFromId: null,
    version: 0,
    ...overrides,
  }
}

export function tabSummary(overrides: Partial<TabSummary> = {}): TabSummary {
  return {
    id: 't1',
    shiftId: SHIFT,
    unitId: UNIT,
    number: 12,
    customerName: 'Dona Marta',
    mode: 'open_tab',
    status: 'open',
    subtotalCents: 3600,
    discountType: null,
    discountValue: null,
    discountCents: 0,
    totalCents: 3600,
    itemCount: 3,
    readyItemCount: 0,
    lateItemCount: 0,
    openedAt: '2026-10-01T19:50:00.000Z',
    openedBy: { type: 'owner', id: 'owner' },
    closedAt: null,
    version: 0,
    ...overrides,
  }
}

export function tab(overrides: Partial<Tab> = {}, items: OrderItem[] = [item()]): Tab {
  return {
    ...tabSummary(),
    orders: [
      {
        id: 'o1',
        tabId: 't1',
        shiftId: SHIFT,
        unitId: UNIT,
        tabNumber: 12,
        customerName: 'Dona Marta',
        numberInTab: 1,
        status: 'sent',
        createdBy: { type: 'owner', id: 'owner' },
        sentAt: '2026-10-01T20:00:00.000Z',
        completedAt: null,
        version: 0,
        items,
      },
    ],
    ...overrides,
  }
}

/** Espeto com "Ponto da carne" obrigatório (1 de 1) e "Acompanhamentos" (0 a 2). */
export function skewer(overrides: Partial<MenuProduct> = {}): MenuProduct {
  return {
    id: 'p1',
    unitId: UNIT,
    categoryId: 'c1',
    name: 'Espeto de carne',
    description: null,
    priceCents: 1200,
    prepStationId: KITCHEN,
    stationId: null,
    sortOrder: 1,
    active: true,
    soldOut: false,
    version: 0,
    modifierGroups: [
      {
        id: 'g-point',
        productId: 'p1',
        name: 'Ponto da carne',
        minChoices: 1,
        maxChoices: 1,
        required: true,
        sortOrder: 1,
        modifiers: [
          {
            id: 'm-rare',
            modifierGroupId: 'g-point',
            name: 'Mal passado',
            priceDeltaCents: 0,
            sortOrder: 1,
            active: true,
          },
          {
            id: 'm-medium',
            modifierGroupId: 'g-point',
            name: 'Ao ponto',
            priceDeltaCents: 0,
            sortOrder: 2,
            active: true,
          },
          {
            id: 'm-off',
            modifierGroupId: 'g-point',
            name: 'Desativado',
            priceDeltaCents: 0,
            sortOrder: 3,
            active: false,
          },
        ],
      },
      {
        id: 'g-sides',
        productId: 'p1',
        name: 'Acompanhamentos',
        minChoices: 0,
        maxChoices: 2,
        required: false,
        sortOrder: 2,
        modifiers: [
          {
            id: 'm-farofa',
            modifierGroupId: 'g-sides',
            name: 'Farofa',
            priceDeltaCents: 0,
            sortOrder: 1,
            active: true,
          },
          {
            id: 'm-bread',
            modifierGroupId: 'g-sides',
            name: 'Pão de alho',
            priceDeltaCents: 300,
            sortOrder: 2,
            active: true,
          },
          {
            id: 'm-vin',
            modifierGroupId: 'g-sides',
            name: 'Vinagrete',
            priceDeltaCents: 0,
            sortOrder: 3,
            active: true,
          },
        ],
      },
    ],
    ...overrides,
  }
}
