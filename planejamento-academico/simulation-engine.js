const DEFAULT_WEIGHTS = {
  capacityFitBonus: 20,
  nearCapacityBonus: 15,
  roomTooLargePenalty: -10,
  sameRoomAllWeekBonus: 25,
  sameRoomNightBonus: 50,
  roomChangePenalty: -30,
  requiredRoomMismatchPenalty: -999,
  missingResourcePenalty: -999,
  saturdayPenalty: -999,
  unallocatedPenalty: -100,
  balancedWeekBonus: 30,
  overloadedDayPenalty: -40,
  eadDistributionBonus: 15,
  idealDistributionBonus: 25 // Todas as disciplinas alocadas
};

export class SimulationEngine {
  constructor(rooms, classes, existingEntries) {
    this.rooms = rooms.filter(r => r.active);
    this.classes = classes.filter(c => c.active);
    this.existingEntries = existingEntries.filter(e => e.active);
    this.weights = DEFAULT_WEIGHTS;
    this.bottlenecks = this.calculateBottlenecks();
  }

  /**
   * Calcula o gargalo por dia: Turmas presenciais agendadas vs Salas disponíveis
   */
  calculateBottlenecks() {
    const dailyOccupancy = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    
    // Contabiliza turmas já ensaladas (presencial)
    this.existingEntries.forEach(entry => {
      if (entry.classType === 'presencial' && entry.weekday >= 1 && entry.weekday <= 5) {
        dailyOccupancy[entry.weekday]++;
      }
    });

    const totalRooms = this.rooms.length;
    const bottlenecks = {};
    
    for (let day = 1; day <= 5; day++) {
      const occupied = dailyOccupancy[day];
      const available = totalRooms - occupied;
      bottlenecks[day] = {
        occupied,
        available,
        isOverloaded: available <= 0,
        status: available <= 2 ? 'crítico' : (available <= 5 ? 'alerta' : 'ok')
      };
    }
    
    return bottlenecks;
  }

  getRequiredCapacity(targetClasses) {
    return targetClasses.reduce((sum, turma) => sum + Number(turma.studentCount || 0), 0);
  }

  isRoomAvailable(roomId, weekday, periods, localAllocations = []) {
    // Verificar no banco de dados global
    const globalConflict = this.existingEntries.some(entry => {
      if (entry.weekday !== weekday) return false;
      if (entry.roomId !== roomId) return false;
      const entryPeriods = entry.periods || [];
      return entryPeriods.some(p => periods.includes(p));
    });

    if (globalConflict) return false;

    // Verificar nas alocações locais desta tentativa de simulação
    const localConflict = localAllocations.some(alloc => {
      if (alloc.weekday !== weekday) return false;
      if (alloc.suggestedRoomId !== roomId) return false;
      return alloc.periods.some(p => periods.includes(p));
    });

    return !localConflict;
  }

  countEadOnDay(classIds, weekday, localAllocations = []) {
    let count = 0;

    // Verificar no banco de dados global (outras turmas mistas ou alocações passadas)
    this.existingEntries.forEach(entry => {
      const entryType = entry.classType || 'presencial';
      if (entryType === 'ead' && entry.weekday === weekday) {
        const entryClassIds = entry.classIds || [entry.classId];
        if (entryClassIds.some(id => classIds.includes(id))) {
          count++;
        }
      }
    });

    // Verificar nas alocações locais desta simulação
    localAllocations.forEach(alloc => {
      const allocType = alloc.classType || 'presencial';
      if (allocType === 'ead' && alloc.weekday === weekday) {
        // targetClasses implicitly applies to all localAllocations for this simulation
        count++;
      }
    });

    return count;
  }

  areClassesAvailable(classIds, weekday, periods, localAllocations = [], currentClassType = 'presencial') {
    // Aulas do tipo Carga Reservada não são bloqueantes (não ocupam slot do dia/período)
    const currentIsBlocking = currentClassType === 'presencial' || currentClassType === 'ead';
    if (!currentIsBlocking) return true;

    // Verificar globalmente: apenas se o lançamento existente for bloqueante (presencial ou ead)
    const globalConflict = this.existingEntries.some(entry => {
      const entryType = entry.classType || 'presencial';
      const entryIsBlocking = entryType === 'presencial' || entryType === 'ead';
      if (!entryIsBlocking) return false;
      
      if (entry.weekday !== weekday) return false;
      const entryClassIds = entry.classIds || [entry.classId];
      if (!entryClassIds.some(id => classIds.includes(id))) return false;
      const entryPeriods = entry.periods || [];
      return entryPeriods.some(p => periods.includes(p));
    });

    if (globalConflict) return false;

    // Verificar localmente: apenas se o lançamento alocado localmente for bloqueante (presencial ou ead)
    const localConflict = localAllocations.some(alloc => {
      const allocType = alloc.classType || 'presencial';
      const allocIsBlocking = allocType === 'presencial' || allocType === 'ead';
      if (!allocIsBlocking) return false;
      
      if (alloc.weekday !== weekday) return false;
      return alloc.periods.some(p => periods.includes(p));
    });

    return !localConflict;
  }

  scoreRoom(room, requiredCapacity, lesson, context) {
    if (!room || !room.active) return { valid: false, score: -999, reasons: ["Sala inativa"] };

    if (Number(room.capacity || 0) < requiredCapacity) {
      return { valid: false, score: -999, reasons: ["Capacidade insuficiente"] };
    }

    if (lesson.requiredRoomType && room.type !== lesson.requiredRoomType) {
      return { valid: false, score: this.weights.requiredRoomMismatchPenalty, reasons: ["Tipo de sala incompatível"] };
    }

    const roomResources = room.resources || [];
    const missingResources = (lesson.requiredResources || []).filter(r => !roomResources.includes(r));

    if (missingResources.length > 0) {
      return { valid: false, score: this.weights.missingResourcePenalty, reasons: ["Recursos obrigatórios ausentes"] };
    }

    const extraSeats = Number(room.capacity || 0) - requiredCapacity;
    let score = this.weights.capacityFitBonus;
    const reasons = ["Sala comporta a turma"];

    if (extraSeats <= 5) {
      score += this.weights.nearCapacityBonus;
      reasons.push("Capacidade excelente (mínima sobra)");
    } else if (extraSeats > requiredCapacity) {
      score += this.weights.roomTooLargePenalty;
      reasons.push("Sala excessivamente grande");
    }

    if (context.preferredRoomId && room.id === context.preferredRoomId) {
      score += 30; // Bônus alto para preferência explícita
      reasons.push("Sala preferencial atendida");
    }

    if (context.previousRoomIds && context.previousRoomIds.includes(room.id)) {
      score += this.weights.sameRoomAllWeekBonus;
      reasons.push("Mantém consistência de sala na semana");
    }

    return { valid: true, score, reasons };
  }

  findBestSlot(targetClasses, lesson, localAllocations, context) {
    const classIds = targetClasses.map(t => t.id);
    const requiredCapacity = this.getRequiredCapacity(targetClasses);
    
    let bestSlot = null;
    let maxScore = -9999;
    
    // Apenas Segunda a Sexta. Sábado (6) removido.
    let weekdays = [1, 2, 3, 4, 5].sort(() => 0.5 - Math.random());

    for (const day of weekdays) {
      let availablePeriods = [...(lesson.periods || [1, 2])];
      let isAvailable = false;

      if (lesson.classType === 'ead') {
        const eadCountOnDay = this.countEadOnDay(classIds, day, localAllocations);
        if (eadCountOnDay >= 2) continue; // max 2 EADs per night

        if (eadCountOnDay === 0) {
           isAvailable = this.areClassesAvailable(classIds, day, [1, 2], localAllocations, lesson.classType);
           availablePeriods = [1];
        } else if (eadCountOnDay === 1) {
           isAvailable = this.areClassesAvailable(classIds, day, [2], localAllocations, lesson.classType);
           availablePeriods = [2];
        }
      } else {
        isAvailable = this.areClassesAvailable(classIds, day, lesson.periods, localAllocations, lesson.classType);
      }

      if (!isAvailable) continue;

      // Penalidade de gargalo se o dia estiver sobrecarregado
      let bottleneckPenalty = 0;
      if (this.bottlenecks[day].isOverloaded && lesson.classType === 'presencial') {
        bottleneckPenalty = this.weights.overloadedDayPenalty;
      }

      // Lógica para EAD ou Carga Reservada
      if (lesson.classType !== 'presencial') {
        if (lesson.classType === 'ead') {
          const eadCountOnDay = this.countEadOnDay(classIds, day, localAllocations);
          
          let eadGroupingBonus = 0;
          if (eadCountOnDay === 1) {
            // Tem exatamente 1 EAD na noite, damos um bônus para agrupar o 2º EAD na mesma noite
            eadGroupingBonus = 50; 
          }

          let score = 20 + bottleneckPenalty + eadGroupingBonus; // Favorece EAD em dias cheios
          if (score > maxScore) {
            maxScore = score;
            bestSlot = {
              weekday: day,
              roomId: null,
              roomName: null,
              score,
              periods: availablePeriods,
              reasons: eadCountOnDay === 1 ? ["Agrupamento de 2 disciplinas EAD na mesma noite (Otimização)"] : ["Aula não presencial ajuda a desafogar a instituição"],
              warnings: bottleneckPenalty < 0 ? ["Dia com alta ocupação de salas"] : []
            };
          }
        } else {
          // Lógica para Carga Reservada
          let score = 20 + bottleneckPenalty;
          if (score > maxScore) {
            maxScore = score;
            bestSlot = {
              weekday: day,
              roomId: null,
              roomName: null,
              score,
              periods: availablePeriods,
              reasons: ["Carga reservada para professor"],
              warnings: []
            };
          }
        }
        continue;
      }

      // Lógica para Presencial
      const selectionMode = lesson.roomSelectionMode || "auto";
      const selectedRoomId = lesson.selectedRoomId;
      let candidateRooms = [];
      let warnings = [];

      if (selectionMode === "required" && selectedRoomId) {
        const room = this.rooms.find(r => r.id === selectedRoomId);
        if (room && this.isRoomAvailable(room.id, day, lesson.periods, localAllocations)) {
          candidateRooms = [room];
        } else {
          continue; // Sala obrigatória ocupada
        }
      } else if (selectionMode === "preferred" && selectedRoomId) {
        const prefRoom = this.rooms.find(r => r.id === selectedRoomId);
        if (prefRoom && this.isRoomAvailable(prefRoom.id, day, lesson.periods, localAllocations)) {
          candidateRooms = [prefRoom];
        } else {
          warnings.push("Sala preferida ocupada, buscando alternativa");
          candidateRooms = this.rooms.filter(r => this.isRoomAvailable(r.id, day, lesson.periods, localAllocations));
        }
      } else {
        candidateRooms = this.rooms.filter(r => this.isRoomAvailable(r.id, day, lesson.periods, localAllocations));
      }

      for (const room of candidateRooms) {
        const evaluation = this.scoreRoom(room, requiredCapacity, lesson, context);
        if (evaluation.valid) {
          let currentScore = evaluation.score + bottleneckPenalty;
          
          // Adiciona uma pequena aleatoriedade para diversificar as tentativas
          currentScore += Math.random() * 5;
          
          if (currentScore > maxScore) {
            maxScore = currentScore;
            bestSlot = {
              weekday: day,
              roomId: room.id,
              roomName: room.name,
              score: Math.floor(currentScore),
              periods: availablePeriods,
              reasons: evaluation.reasons,
              warnings: [...warnings, ...(bottleneckPenalty < 0 ? ["Dia com alta demanda de salas"] : [])]
            };
          }
        }
      }
    }

    return bestSlot;
  }

  scoreWeeklyDistribution(allocations) {
    let score = 0;
    const reasons = [];
    const warnings = [];

    // Apenas aulas presenciais e EAD (que são bloqueantes) devem ser obrigatoriamente alocadas.
    // Carga Reservada não precisa ocupar lugar e pode ficar sem dia.
    const unallocatedBlocking = allocations.filter(a => (a.classType === 'presencial' || a.classType === 'ead') && !a.weekday).length;
    if (unallocatedBlocking > 0) {
      score += (unallocatedBlocking * this.weights.unallocatedPenalty);
      warnings.push(`${unallocatedBlocking} aula(s) sem espaço na agenda`);
    }

    const presencialAllocs = allocations.filter(a => a.classType === 'presencial' && a.weekday !== null);
    const nonPresencialAllocs = allocations.filter(a => a.classType !== 'presencial' && a.weekday !== null);

    // Regra: Todas as disciplinas da matriz foram alocadas com sucesso
    if (unallocatedBlocking === 0) {
      score += this.weights.idealDistributionBonus;
      reasons.push("Todas as disciplinas da matriz foram alocadas com sucesso");
    }

    // Regra: Mesma sala a semana toda
    const uniqueRooms = new Set(presencialAllocs.map(a => a.suggestedRoomId).filter(Boolean));
    if (uniqueRooms.size === 1 && presencialAllocs.length > 1) {
      score += this.weights.sameRoomAllWeekBonus;
      reasons.push("Mantém a mesma sala em todos os dias presenciais");
    } else if (uniqueRooms.size > 1) {
      score += this.weights.roomChangePenalty;
      warnings.push("Troca de sala ao longo da semana");
    }

    // Regra: Distribuição equilibrada (evitar tudo na segunda/terça)
    const days = presencialAllocs.map(a => a.weekday).sort();
    let isBalanced = true;
    for (let i = 1; i < days.length; i++) {
        if (days[i] === days[i-1]) isBalanced = false; // Não deveria acontecer se findBestSlot checar areClassesAvailable
    }
    if (isBalanced && presencialAllocs.length > 0) {
        score += this.weights.balancedWeekBonus;
        reasons.push("Boa distribuição dos dias presenciais");
    }

    return { score, reasons, warnings };
  }

  attemptAllocation(targetClasses, lessons) {
    const allocations = [];
    const context = {
      previousRoomIds: [],
      preferredRoomId: null
    };

    // Priorizar aulas na ordem: presencial -> ead -> carga_reservada
    const sortedLessons = [...lessons].sort((a, b) => {
      const priority = { presencial: 1, ead: 2, carga_reservada: 3 };
      return (priority[a.classType] || 4) - (priority[b.classType] || 4);
    });

    for (const lesson of sortedLessons) {
      if (lesson.selectedRoomId && lesson.roomSelectionMode === "preferred") {
        context.preferredRoomId = lesson.selectedRoomId;
      }

      const result = this.findBestSlot(targetClasses, lesson, allocations, context);

      if (result) {
        allocations.push({
          ...lesson,
          weekday: result.weekday,
          periods: result.periods || lesson.periods,
          suggestedRoomId: result.roomId,
          suggestedRoomName: result.roomName,
          score: result.score,
          reasons: result.reasons,
          warnings: result.warnings || [],
          conflicts: []
        });
        if (result.roomId) context.previousRoomIds.push(result.roomId);
      } else {
        allocations.push({
          ...lesson,
          weekday: null,
          suggestedRoomId: null,
          suggestedRoomName: null,
          score: this.weights.unallocatedPenalty,
          reasons: [],
          warnings: [],
          conflicts: ["Sem horários ou salas disponíveis"]
        });
      }
    }

    const distribution = this.scoreWeeklyDistribution(allocations);
    const totalScore = allocations.reduce((sum, a) => sum + (a.score || 0), 0) + distribution.score;

    let status = 'boa';
    if (totalScore >= 150) status = 'ideal';
    else if (totalScore < 50) status = 'atencao';
    
    const hasUnallocatedBlocking = allocations.some(a => (a.classType === 'presencial' || a.classType === 'ead') && !a.weekday);
    const hasPresencialWithoutRoom = allocations.some(a => a.classType === 'presencial' && !a.suggestedRoomId);
    
    if (hasUnallocatedBlocking || hasPresencialWithoutRoom) {
      status = 'inviavel';
    }

    // Gerar sumário humano
    const summaryParts = [];
    if (status === 'ideal') summaryParts.push("Excelente sugestão.");
    else if (status === 'boa') summaryParts.push("Sugestão equilibrada.");
    else if (status === 'atencao') summaryParts.push("Atenção aos alertas desta sugestão.");
    else summaryParts.push("Sugestão inviável por falta de recursos.");

    if (distribution.reasons.length > 0) summaryParts.push(distribution.reasons[0] + ".");
    
    return {
      id: 'sim_' + Math.random().toString(36).substr(2, 9),
      score: Math.floor(totalScore),
      status,
      summary: summaryParts.join(" "),
      allocations: allocations.sort((a, b) => (a.weekday || 9) - (b.weekday || 9)),
      reasons: [...new Set(allocations.flatMap(a => a.reasons), ...distribution.reasons)].slice(0, 3),
      warnings: [...new Set([...allocations.flatMap(a => a.warnings), ...distribution.warnings])]
    };
  }

  generateSuggestions(courseId, classIds, lessonsToAllocate) {
    const suggestions = [];
    const targetClasses = classIds.map(id => this.classes.find(c => c.id === id)).filter(Boolean);
    
    if (targetClasses.length === 0) return [];

    const seenFingerprints = new Set();
    const attempts = 50; // Aumentado conforme solicitado

    for (let i = 0; i < attempts; i++) {
      const suggestion = this.attemptAllocation(targetClasses, lessonsToAllocate);
      
      if (suggestion) {
        // Criar um fingerprint para evitar duplicatas visuais
        const fingerprint = suggestion.allocations.map(a => 
            `${a.weekday}-${a.suggestedRoomId}`
        ).sort().join('|');

        if (!seenFingerprints.has(fingerprint)) {
            seenFingerprints.add(fingerprint);
            suggestions.push(suggestion);
        }
      }
    }

    // Retornar as top 5 melhores
    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }
}
